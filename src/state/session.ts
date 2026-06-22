// Session orchestrator: research -> weave -> online feed (the useFeed analog
// from TestApp, rebuilt for source passages). Owns notes so the feed pane can
// clip excerpts straight into the notebook pane.
//
// Gating: the feed never generates or reveals material past an unanswered gate
// (a weave checkpoint or a check for understanding). Clearing the gate resumes
// generation. This is what "lock the next cards until it is answered, then the
// material continues" means in the data flow.

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CardSignals,
  CheckCard,
  CheckpointCard,
  Corpus,
  DefinitionCard,
  FeedCard,
  FormulaCard,
  GateCard,
  PassageCard,
  ProviderProgress,
} from '../types';
import { isGate } from '../types';
import { research } from '../research/providers';
import { buildExpansionMap, buildStudyMap, mergeResearch, researchBranches } from '../research/expand';
import { classifyQuery } from '../research/classify';
import type { QueryType } from '../research/classify';
import { addContribution, excludeDocFromGraph } from './graphStore';
import { queryTokens, urlsToMarkdownLinks } from '../research/net';
import { defineTerm } from '../research/wiktionary';
import { extractConcepts } from '../weave/terms';
import { annotateDefinitions, buildConnections } from '../weave/connections';
import { annotateDepth, DEPTH_LABEL } from '../weave/depth';
import type { DepthRung } from '../weave/depth';
import { Loom } from '../weave/loom';
import { TypeBandit } from '../weave/bandit';
import { loadWeights, saveWeights } from '../weave/weights';
import type { WeaveWeights } from '../weave/weights';
import { autoTune } from '../weave/tune';
import type { TuneResult } from '../weave/tune';
import { aiConfigured } from '../ai/llm';
import type { WebllmProgress } from '../ai/webllm';
import {
  addReport,
  DEFAULT_PREFS,
  loadBandit,
  loadNotes,
  loadPrefs,
  loadReports,
  loadSettings,
  rememberTopic,
  saveBandit,
  saveNotes,
  slugify,
} from './storage';

export type Phase = 'researching' | 'expanding' | 'weaving' | 'ready' | 'empty';

export interface SessionStats {
  cardsViewed: number;
  clips: number;
  checkpoints: number;
  checksCorrect: number;
  checksAnswered: number;
}

const LOOKAHEAD = 4;
// Endless frontier feed: at Frontier-level reach the feed keeps gathering fresh
// angles instead of ending. Each wave grows the corpus; the near-duplicate merge
// halts it naturally once a topic is mined out, and MAX_WAVES is a hard backstop.
const FRONTIER_RADIUS = 0.7;
const MAX_WAVES = 12;
const WAVE_CAP_GROWTH = 80;

function emptySignals(): CardSignals {
  return { dwellMs: 0, clipped: false, openedSource: false, checkpointInserted: false };
}

export function useSession(query: string) {
  const slug = slugify(query);
  const [phase, setPhase] = useState<Phase>('researching');
  const [progress, setProgress] = useState<ProviderProgress[]>([]);
  // Cold-start load progress for the in-browser small model (null = warm or
  // not in use), surfaced during the "expanding" phase so the screen shows a
  // bar instead of appearing frozen on the first run / after a reload.
  const [modelLoad, setModelLoad] = useState<WebllmProgress | null>(null);
  // True while a configured model is actively generating the study map -- the
  // one place any model runs. Drives a "working" spinner so generation on a
  // slow machine reads as busy, not frozen.
  const [mapGenerating, setMapGenerating] = useState(false);
  const [corpus, setCorpus] = useState<Corpus | null>(null);
  const [cards, setCards] = useState<FeedCard[]>([]);
  const [completedGates, setCompletedGates] = useState<Set<string>>(new Set());
  const [skippedGates, setSkippedGates] = useState<Set<string>>(new Set());
  const [reportedDocs, setReportedDocs] = useState<Set<string>>(new Set());
  const [mutedConcepts, setMutedConcepts] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState<string>(() => loadNotes(slug) ?? `# ${query}\n\n`);
  const [noteInsertTick, setNoteInsertTick] = useState(0);
  const [viewedCardIds, setViewedCardIds] = useState<Set<string>>(new Set());
  const [stats, setStats] = useState<SessionStats>({
    cardsViewed: 0,
    clips: 0,
    checkpoints: 0,
    checksCorrect: 0,
    checksAnswered: 0,
  });
  const [stage, setStage] = useState<{ score: number; rung: DepthRung; label: string }>({
    score: 0,
    rung: 0,
    label: DEPTH_LABEL[0],
  });

  const [loadingMore, setLoadingMore] = useState(false); // an endless-frontier wave is gathering

  const loomRef = useRef<Loom | null>(null);
  const corpusRef = useRef<Corpus | null>(null); // cached so the dev panel can replay the feed without re-research
  // -- endless frontier state -------------------------------------------------
  const radiusRef = useRef(0.5);
  const qTypeRef = useRef<QueryType>('topic');
  const usedQueriesRef = useRef<Set<string>>(new Set()); // branch queries already gathered
  const waveRef = useRef(0);
  const expandingRef = useRef(false);
  const exhaustedRef = useRef(false); // a wave returned nothing new -> topic mined out
  const aliveRef = useRef(true); // false once this session unmounts / the query changes
  const expandRef = useRef<null | (() => void)>(null);
  // Serialize knowledge-graph writes so overlapping folds (ready + each wave)
  // never race on the stored graph.
  const graphChainRef = useRef<Promise<void>>(Promise.resolve());
  const foldRef = useRef<null | (() => void)>(null);
  const weightsRef = useRef<WeaveWeights>(loadWeights());
  const banditRef = useRef<TypeBandit | null>(null);
  if (!banditRef.current) banditRef.current = new TypeBandit(loadBandit());
  const cardsRef = useRef<FeedCard[]>([]);
  const completedGatesRef = useRef<Set<string>>(new Set());
  const lastVisibleIndexRef = useRef(0);
  const doneRef = useRef(false);
  const signalsRef = useRef(new Map<string, CardSignals>());
  const dwellStartRef = useRef(new Map<string, number>());
  const rewardedRef = useRef(new Set<string>());

  // -- gate-aware generation (online, like the engine's nextCard loop) --------
  // Never generates past a gate that has not been cleared.
  const pumpTo = useCallback((target: number) => {
    const loom = loomRef.current;
    if (!loom || doneRef.current) return;
    const add: FeedCard[] = [];
    const openGate = () =>
      [...cardsRef.current, ...add].some((c) => isGate(c) && !completedGatesRef.current.has(c.id));
    while (cardsRef.current.length + add.length < target) {
      if (openGate()) break;
      const card = loom.next();
      if (!card || card.kind === 'end') {
        // Endless frontier: at high reach, gather another wave of angles rather
        // than ending. The wave runs async and pumps again when it lands.
        if (
          radiusRef.current >= FRONTIER_RADIUS &&
          !exhaustedRef.current &&
          !expandingRef.current &&
          waveRef.current < MAX_WAVES &&
          corpusRef.current
        ) {
          expandRef.current?.();
          break; // hold here; do not append an end card
        }
        if (!card) {
          doneRef.current = true;
          break;
        }
        add.push(card); // genuine end of a bounded feed
        doneRef.current = true;
        break;
      }
      add.push(card);
    }
    if (add.length > 0) {
      cardsRef.current = [...cardsRef.current, ...add];
      setCards(cardsRef.current);
      setStage(loom.stage());
    }
  }, []);

  // -- endless frontier: gather one more wave of angles, grow the corpus in
  // place, and resume the feed. Best-effort: a wave that surfaces nothing new
  // (everything deduped) marks the topic mined out and the feed ends normally.
  const expandMore = useCallback(async () => {
    const corpus = corpusRef.current;
    const loom = loomRef.current;
    if (!corpus || !loom || expandingRef.current || exhaustedRef.current) return;
    expandingRef.current = true;
    waveRef.current += 1;
    setLoadingMore(true);
    try {
      const onProgress = (u: ProviderProgress) => {
        if (!aliveRef.current) return;
        setProgress((prev) => {
          const next = prev.filter((p) => p.name !== u.name);
          next.push(u);
          return next.sort((a, b) => a.name.localeCompare(b.name));
        });
      };

      const map = buildExpansionMap(
        query,
        corpus.concepts,
        qTypeRef.current,
        radiusRef.current,
        usedQueriesRef.current,
        waveRef.current,
      );
      for (const b of map.branches) usedQueriesRef.current.add(b.query.toLowerCase());
      if (map.branches.length === 0) {
        exhaustedRef.current = true;
        return;
      }

      const reportedUrls = new Set(loadReports().map((r) => r.url));
      const branchRes = await researchBranches(map, radiusRef.current, onProgress, qTypeRef.current);
      if (!aliveRef.current) return;

      const merged = mergeResearch(
        { docs: [...corpus.docs.values()], passages: corpus.passages },
        {
          docs: branchRes.docs.filter((d) => !reportedUrls.has(d.url)),
          passages: branchRes.passages,
        },
        corpus.passages.length + WAVE_CAP_GROWTH,
      );
      // Nothing survived the near-duplicate merge -> the topic is mined out.
      if (merged.passages.length <= corpus.passages.length) {
        exhaustedRef.current = true;
        return;
      }

      // Re-weave over the grown corpus (wiktionary/formula passes skipped for
      // speed -- waves widen perspective, the seed already grounded the terms).
      const concepts = extractConcepts(merged.passages, query);
      annotateDefinitions(merged.passages, concepts);
      const docMap = new Map(merged.docs.map((d) => [d.id, d]));
      annotateDepth(merged.passages, docMap, concepts);
      corpus.docs = docMap;
      corpus.passages = merged.passages;
      corpus.concepts = concepts;
      corpus.connections = buildConnections(merged.passages, concepts);
      loom.extend();
      if (aliveRef.current) setCorpus({ ...corpus });
      foldRef.current?.(); // fold the freshly-widened corpus into the graph
    } catch {
      // Leave exhausted untouched: a transient failure can retry next wave.
    } finally {
      expandingRef.current = false;
      if (aliveRef.current) {
        setLoadingMore(false);
        pumpTo(cardsRef.current.length + LOOKAHEAD);
      }
    }
  }, [query, pumpTo]);
  useEffect(() => {
    expandRef.current = expandMore;
  }, [expandMore]);

  // -- knowledge graph: fold this session's woven corpus into the persistent
  // graph (auto by default; the home/settings toggle can turn it off, in which
  // case `addToGraph` does it on demand). Reuses the already-built corpus -- no
  // re-research, no re-weave. Writes are serialized via graphChainRef.
  const foldIntoGraph = useCallback(
    (force = false) => {
      const corpus = corpusRef.current;
      if (!corpus) return;
      if (!force && loadSettings().autoGraph === false) return;
      const contribution = {
        query,
        docs: [...corpus.docs.values()],
        passages: corpus.passages,
        concepts: corpus.concepts,
        formulas: corpus.formulas,
      };
      graphChainRef.current = graphChainRef.current
        .then(() => addContribution(contribution))
        .catch(() => {});
    },
    [query],
  );
  const addToGraph = useCallback(() => foldIntoGraph(true), [foldIntoGraph]);
  useEffect(() => {
    foldRef.current = () => foldIntoGraph();
  }, [foldIntoGraph]);

  // Rebuild the Loom over the CACHED corpus with new weights and replay the feed
  // from the top -- no re-research, no model, no re-weave. Powers the dev tuning
  // panel; the weights persist so they also drive future sessions.
  const reLoom = useCallback(
    (weights: WeaveWeights) => {
      const built = corpusRef.current;
      if (!built) return;
      weightsRef.current = weights;
      saveWeights(weights);
      const prefs = loadPrefs() ?? DEFAULT_PREFS;
      const loom = new Loom(
        built,
        banditRef.current!,
        { checkpointEvery: prefs.checkpointEvery, opening: prefs.opening },
        weights,
      );
      loomRef.current = loom;
      cardsRef.current = [];
      doneRef.current = false;
      completedGatesRef.current = new Set();
      setCompletedGates(new Set());
      setSkippedGates(new Set());
      setCards([]);
      pumpTo(LOOKAHEAD);
      setStage(loom.stage());
    },
    [pumpTo],
  );

  // Search WeaveWeights for the configuration that maximizes a feed-quality
  // objective on THIS session's corpus (separable CMA-ES; see weave/tune.ts),
  // then apply + persist the winner via reLoom. Powers the dev panel's Auto-tune.
  const tuneWeights = useCallback(
    async (onProgress?: (gen: number, best: number) => void): Promise<TuneResult | null> => {
      const built = corpusRef.current;
      if (!built) return null;
      const prefs = loadPrefs() ?? DEFAULT_PREFS;
      const result = await autoTune(
        built,
        { checkpointEvery: prefs.checkpointEvery, opening: prefs.opening },
        weightsRef.current,
        onProgress,
      );
      reLoom(result.weights);
      return result;
    },
    [reLoom],
  );

  // -- boot pipeline ----------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    rememberTopic(query, slug);
    setPhase('researching');
    setProgress([]);
    setModelLoad(null);
    setMapGenerating(false);
    setCards([]);
    setCompletedGates(new Set());
    setSkippedGates(new Set());
    setReportedDocs(new Set());
    setMutedConcepts(new Set());
    setCorpus(null);
    cardsRef.current = [];
    completedGatesRef.current = new Set();
    doneRef.current = false;
    // reset endless-frontier state for the new query
    aliveRef.current = true;
    waveRef.current = 0;
    expandingRef.current = false;
    exhaustedRef.current = false;
    usedQueriesRef.current = new Set();
    setLoadingMore(false);

    (async () => {
      const onProgress = (update: { name: string; status: 'pending' | 'ok' | 'fail'; passages: number }) => {
        if (cancelled) return;
        setProgress((prev) => {
          const next = prev.filter((p) => p.name !== update.name);
          next.push(update);
          return next.sort((a, b) => a.name.localeCompare(b.name));
        });
      };

      const seed = await research(query, onProgress);
      if (cancelled) return;
      if (seed.passages.length < 3) {
        setPhase('empty');
        return;
      }

      // Sources the learner has reported never enter another weave.
      const reportedUrls = new Set(loadReports().map((r) => r.url));
      let docs = seed.docs.filter((d) => !reportedUrls.has(d.url));
      let liveIds = new Set(docs.map((d) => d.id));
      let passages = seed.passages.filter((p) => liveIds.has(p.docId));
      const formulas = seed.formulas;

      // -- branch out: squeeze the main idea for what it presupposes/contains.
      // The study map (model-built when one is configured, heuristic
      // otherwise) names neighboring threads; each is researched with the
      // same real providers, within the learner's chosen reach.
      setPhase('expanding');
      const radius = Math.max(0, Math.min(1, loadSettings().ai?.radius ?? 0.5));
      const seedConcepts = extractConcepts(passages, query);
      const seedDocMap = new Map(docs.map((d) => [d.id, d]));
      // What KIND of thing is this? Person / event / philosophy / topic steers
      // which angles the study map reaches for (research/classify.ts).
      const qType = classifyQuery(query, passages, seedDocMap);
      radiusRef.current = radius;
      qTypeRef.current = qType;
      if (aiConfigured()) setMapGenerating(true); // heuristic returns instantly — no spinner
      const studyMap = await buildStudyMap(query, passages, seedDocMap, seedConcepts, radius, qType, (p) => {
        if (!cancelled) setModelLoad(p);
      });
      // Remember what we've already gathered so endless-frontier waves open new ground.
      for (const b of studyMap.branches) usedQueriesRef.current.add(b.query.toLowerCase());
      if (cancelled) return;
      setMapGenerating(false);
      setModelLoad(null); // model work is done; clear the bar for branch research
      const branchRes = await researchBranches(studyMap, radius, onProgress, qType);
      if (cancelled) return;
      const merged = mergeResearch(
        { docs, passages },
        {
          docs: branchRes.docs.filter((d) => !reportedUrls.has(d.url)),
          passages: branchRes.passages,
        },
        140,
      );
      docs = merged.docs;
      passages = merged.passages;
      liveIds = new Set(docs.map((d) => d.id));

      setPhase('weaving');
      const concepts = extractConcepts(passages, query);
      annotateDefinitions(passages, concepts);

      // Tie each harvested formula to the threads it grounds: a concept whose
      // term appears in the equation's own name, section, or introducing prose.
      for (const f of formulas) {
        const hay = `${f.caption ?? ''} ${f.section ?? ''} ${f.context ?? ''}`.toLowerCase();
        f.conceptIds = concepts
          .filter((c) => {
            if (!c.important) return false;
            const esc = c.label.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp(`\\b${esc}(?:s|es)?\\b`).test(hay);
          })
          .map((c) => c.id);
      }

      // Wiktionary fallback ONLY for recurring, meaningful terms no source
      // defines -- and the sense is chosen in the corpus's own context, so
      // "spectral" reads as spectra, not spectres, inside a Fourier session.
      // Each context word carries its concept's df as weight: central terms
      // outvote words contributed by niche bigrams when senses compete.
      const contextWords = new Map<string, number>();
      for (const c of concepts) {
        for (const w of c.id.split(' ')) {
          if (w.length >= 4) contextWords.set(w, Math.max(contextWords.get(w) ?? 0, c.df));
        }
      }
      for (const w of queryTokens(query)) {
        contextWords.set(w, Math.max(contextWords.get(w) ?? 0, 6));
      }
      const orphans = concepts
        .filter((c) => c.important && !c.definedByPassage && c.df >= 3)
        .slice(0, 8);
      await Promise.all(
        orphans.map(async (c) => {
          // Look up the normalized form first ("function", not "functions") --
          // plural slugs land on form-of stubs; fall back to the surface label.
          const def =
            (await defineTerm(c.id, contextWords)) ??
            (c.id !== c.label.toLowerCase() ? await defineTerm(c.label, contextWords) : null);
          if (def) c.definition = def;
        }),
      );
      if (cancelled) return;

      const docMap = new Map(docs.map((d) => [d.id, d]));
      annotateDepth(passages, docMap, concepts);
      const built: Corpus = {
        docs: docMap,
        passages,
        concepts,
        connections: buildConnections(passages, concepts),
        formulas: formulas.filter((f) => f.conceptIds.length > 0),
        studyMap,
      };
      const prefs = loadPrefs() ?? DEFAULT_PREFS;
      const loom = new Loom(
        built,
        banditRef.current!,
        { checkpointEvery: prefs.checkpointEvery, opening: prefs.opening },
        weightsRef.current,
      );
      loomRef.current = loom;
      corpusRef.current = built;
      cardsRef.current = [];
      setCorpus(built);
      pumpTo(LOOKAHEAD);
      setPhase('ready');
      foldIntoGraph(); // auto-fold this session's weave into the knowledge graph
    })();

    return () => {
      cancelled = true;
      aliveRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const ensureAhead = useCallback(
    (visibleIndex: number) => {
      pumpTo(visibleIndex + LOOKAHEAD);
    },
    [pumpTo],
  );

  // -- engagement signals -> bandit reward (learning gain, not dwell) ----------
  const sig = (cardId: string): CardSignals => {
    let s = signalsRef.current.get(cardId);
    if (!s) {
      s = emptySignals();
      signalsRef.current.set(cardId, s);
    }
    return s;
  };

  const onCardVisible = useCallback(
    (card: FeedCard, listIndex: number) => {
      lastVisibleIndexRef.current = listIndex;
      ensureAhead(listIndex + 1);
      dwellStartRef.current.set(card.id, performance.now());
      setViewedCardIds((prev) => {
        if (prev.has(card.id)) return prev;
        const next = new Set(prev);
        next.add(card.id);
        setStats((s) => ({ ...s, cardsViewed: s.cardsViewed + 1 }));
        return next;
      });
    },
    [ensureAhead],
  );

  const onCardHidden = useCallback((card: FeedCard) => {
    const start = dwellStartRef.current.get(card.id);
    if (start !== undefined) {
      sig(card.id).dwellMs += performance.now() - start;
      dwellStartRef.current.delete(card.id);
    }
    if (card.kind !== 'passage' || rewardedRef.current.has(card.id)) return;
    rewardedRef.current.add(card.id);
    banditRef.current!.reward(card.doc.sourceType, sig(card.id));
    saveBandit(banditRef.current!.toJSON());
  }, []);

  // -- notes ------------------------------------------------------------------
  useEffect(() => {
    const timer = setTimeout(() => saveNotes(slug, notes), 400);
    return () => clearTimeout(timer);
  }, [slug, notes]);

  const appendToNotes = useCallback((md: string) => {
    setNotes((n) => `${n.trimEnd()}\n\n${md}\n`);
    setNoteInsertTick((t) => t + 1);
  }, []);

  const clipCard = useCallback(
    (card: PassageCard | DefinitionCard | FormulaCard) => {
      if (card.kind === 'passage') {
        const { passage, doc } = card;
        const who = doc.author ? `, ${doc.author}` : '';
        const where = passage.anchor ? `, ${passage.anchor}` : '';
        appendToNotes(
          `> ${urlsToMarkdownLinks(passage.text)}\n>\n> — [${doc.title}](${passage.anchorUrl ?? doc.url})${who} (${doc.provider}${where})`,
        );
      } else if (card.kind === 'formula') {
        const cap = card.caption ?? card.label;
        appendToNotes(
          `**${cap}**\n\n![${cap}](${card.svgUrl})\n\n— [${card.sourceTitle}](${card.url})`,
        );
      } else {
        appendToNotes(`> **${card.label}** — ${card.definition}\n>\n> — [${card.source}](${card.url})`);
      }
      sig(card.id).clipped = true;
      setStats((s) => ({ ...s, clips: s.clips + 1 }));
    },
    [appendToNotes],
  );

  const openSource = useCallback((card: FeedCard) => {
    sig(card.id).openedSource = true;
  }, []);

  // -- gates: clearing one unlocks the feed and resumes generation ------------
  const clearGate = useCallback(
    (cardId: string) => {
      if (completedGatesRef.current.has(cardId)) return;
      completedGatesRef.current = new Set(completedGatesRef.current).add(cardId);
      setCompletedGates(completedGatesRef.current);
      // Resume: fill the next window now that the gate is open.
      pumpTo(cardsRef.current.length + LOOKAHEAD);
      if (loomRef.current) setStage(loomRef.current.stage());
    },
    [pumpTo],
  );

  /** The learner wrote their own connection -- real synthesis (Socratic). */
  const submitCheckpoint = useCallback(
    (card: CheckpointCard, answer: string) => {
      const written = answer.trim();
      appendToNotes(
        `## Weave: ${card.labelA} × ${card.labelB}\n\n` +
          `*${card.prompt}*\n\n` +
          `> ${urlsToMarkdownLinks(card.quoteA.text)}\n>\n> — [${card.quoteA.title}](${card.quoteA.url}) (card ${card.cardRefA})\n\n` +
          `> ${urlsToMarkdownLinks(card.quoteB.text)}\n>\n> — [${card.quoteB.title}](${card.quoteB.url}) (card ${card.cardRefB})\n\n` +
          `**My connection:** ${written}\n`,
      );
      sig(card.id).checkpointInserted = true;
      setStats((s) => ({ ...s, checkpoints: s.checkpoints + 1 }));
      loomRef.current?.noteCheckpointWoven(); // real synthesis advances mastery
      clearGate(card.id);
    },
    [appendToNotes, clearGate],
  );

  /** A check for understanding was answered -- correctness drives retention. */
  const submitCheck = useCallback(
    (card: CheckCard, correct: boolean) => {
      banditRef.current!.rewardRetention(card.sourceType, correct);
      saveBandit(banditRef.current!.toJSON());
      setStats((s) => ({
        ...s,
        checksAnswered: s.checksAnswered + 1,
        checksCorrect: s.checksCorrect + (correct ? 1 : 0),
      }));
      clearGate(card.id);
    },
    [clearGate],
  );

  /**
   * Accessibility: pass a gate without answering it. The feed reopens, but
   * no learning signal fires -- a skip is silence, not evidence.
   */
  const skipGate = useCallback(
    (card: GateCard) => {
      setSkippedGates((prev) => new Set(prev).add(card.id));
      clearGate(card.id);
    },
    [clearGate],
  );

  /**
   * Flag a bad source (broken OCR, off-topic, untrustworthy). Its remaining
   * excerpts leave this weave, and it never enters a future one.
   */
  const reportSource = useCallback((card: PassageCard) => {
    addReport(card.doc.url, card.doc.title);
    loomRef.current?.excludeDoc(card.doc.id);
    setReportedDocs((prev) => new Set(prev).add(card.doc.id));
    // A reported source also leaves the persistent graph and stays out of it.
    graphChainRef.current = graphChainRef.current
      .then(() => excludeDocFromGraph(card.doc.url))
      .catch(() => {});
  }, []);

  const toggleMuteConcept = useCallback((conceptId: string) => {
    setMutedConcepts((prev) => {
      const next = new Set(prev);
      if (next.has(conceptId)) next.delete(conceptId);
      else next.add(conceptId);
      return next;
    });
  }, []);

  return {
    slug,
    phase,
    progress,
    modelLoad,
    mapGenerating,
    reLoom,
    tuneWeights,
    corpus,
    cards,
    loadingMore,
    completedGates,
    skippedGates,
    reportedDocs,
    mutedConcepts,
    notes,
    setNotes,
    noteInsertTick,
    viewedCardIds,
    stats,
    stage,
    onCardVisible,
    onCardHidden,
    clipCard,
    openSource,
    submitCheckpoint,
    submitCheck,
    skipGate,
    reportSource,
    toggleMuteConcept,
    addToGraph,
  };
}

export type Session = ReturnType<typeof useSession>;
