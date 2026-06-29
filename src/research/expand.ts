// Branch-out research: the fix for over-generalized sessions. Searching only
// the main idea gathers sources that MENTION it and hopes the splice carries
// understanding; a learner asking about AI actually needs how it works, the
// concepts that precede it, the technology inside it. So after the seed
// research, Tessera builds a STUDY MAP -- neighboring threads worth real
// sources -- and researches each branch with the same providers. The model
// (when one is configured) reads the seed material and names the branches;
// with no model, a heuristic over the seed corpus's own recurring concepts
// does the branching. Either way every excerpt stays verbatim: the map only
// decides WHAT to gather, never what to say.

import type { Concept, Passage, ProviderProgress, SourceDoc, StudyBranch, StudyMap } from '../types';
import { allowedKinds, branchBudget, contextBudget, STUDY_MAP_SYSTEM, studyMapUser } from '../ai/prompts';
import { aiConfigured, complete, extractJson } from '../ai/llm';
import type { WebllmProgress } from '../ai/webllm';
import { searchOpenAlex } from './openalex';
import { searchWiki } from './wiki';
import { searchChronicling } from './chronicling';
import { searchArchive } from './archive';
import { searchHN } from './hn';
import { searchGuardian } from './guardian';
import { searchNYT } from './nyt';
import type { QueryType } from './classify';
import { nearDuplicate, wordSet } from './providers';

type ProgressFn = (update: ProviderProgress) => void;

interface BranchResearch {
  docs: SourceDoc[];
  passages: Passage[];
}

// -- building the map ---------------------------------------------------------

const KIND_SET = new Set([
  'context',
  'prerequisite',
  'mechanism',
  'component',
  'application',
  'foundation',
  'frontier',
  'adjacent',
]);

interface RawMap {
  idea?: unknown;
  branches?: { kind?: unknown; concept?: unknown; query?: unknown; why?: unknown }[];
}

/** Validate + clamp whatever the model returned into a usable map, or null. */
function sanitizeModelMap(raw: RawMap | null, query: string, radius: number): StudyMap | null {
  if (!raw || !Array.isArray(raw.branches)) return null;
  const kinds = new Set(allowedKinds(radius));
  const seen = new Set<string>();
  const branches: StudyBranch[] = [];
  let contextCount = 0; // the lead-up arc is reach-capped so it never strays too far
  for (const b of raw.branches) {
    if (typeof b?.kind !== 'string' || typeof b?.concept !== 'string' || typeof b?.query !== 'string') continue;
    const kind = b.kind.toLowerCase().trim();
    if (!KIND_SET.has(kind) || !kinds.has(kind as StudyBranch['kind'])) continue;
    if (kind === 'context' && contextCount >= contextBudget(radius)) continue;
    const concept = b.concept.trim();
    const q = b.query.trim();
    if (concept.length < 3 || q.length < 3 || q.length > 90) continue;
    // The branch must not just be the main idea again.
    if (q.toLowerCase() === query.toLowerCase()) continue;
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (kind === 'context') contextCount += 1;
    branches.push({
      kind: kind as StudyBranch['kind'],
      concept,
      query: q,
      why: typeof b.why === 'string' && b.why.trim() ? b.why.trim().slice(0, 180) : `Supporting thread for “${query}”.`,
    });
    if (branches.length >= branchBudget(radius)) break;
  }
  if (branches.length === 0) return null;
  return {
    idea: typeof raw.idea === 'string' && raw.idea.trim() ? raw.idea.trim() : query,
    branches,
    builtBy: 'model',
  };
}

/**
 * Model-free branching: the seed corpus's own recurring concepts ARE the
 * neighboring threads (a term many independent sources share is structure,
 * not vocabulary), plus two synthetic rungs of the iceberg that almost every
 * topic has a real article for: its history, and its debates.
 */
/**
 * Type-specific threads for a person / event / philosophy: the angles the
 * learner's request is really asking for. Each is reach-gated by its kind like
 * any other branch, and leads the queue ahead of generic concept branches.
 */
function typeBranchSpecs(query: string, qType: QueryType): StudyBranch[] {
  switch (qType) {
    case 'person':
      return [
        { kind: 'context', concept: 'early life & formation', query: `${query} early life`, why: `Where ${query} came from — the background that shaped them.` },
        { kind: 'application', concept: 'what they did', query: `${query} career achievements`, why: `The work and acts ${query} is actually known for.` },
        { kind: 'frontier', concept: 'reception & criticism', query: `${query} criticism controversy`, why: `How contemporaries and later critics judged ${query} — the contested views.` },
        { kind: 'frontier', concept: 'legacy & differing assessments', query: `${query} legacy influence`, why: `What ${query} left behind, and where assessments diverge.` },
      ];
    case 'event':
      return [
        { kind: 'context', concept: 'causes & lead-up', query: `causes of ${query}`, why: `What set the stage for ${query}.` },
        { kind: 'application', concept: 'aftermath & consequences', query: `${query} aftermath consequences`, why: `What ${query} changed, and what followed.` },
        { kind: 'frontier', concept: 'competing interpretations', query: `${query} historiography interpretations`, why: `How historians and the different sides read ${query} differently.` },
      ];
    case 'philosophy':
      return [
        { kind: 'prerequisite', concept: 'core tenets', query: `${query} key concepts principles`, why: `The central claims ${query} rests on.` },
        { kind: 'foundation', concept: 'origins', query: `origins of ${query}`, why: `Where ${query} came from and what it answered.` },
        { kind: 'frontier', concept: 'criticisms', query: `criticism of ${query}`, why: `The strongest arguments against ${query}.` },
        { kind: 'frontier', concept: 'rival schools', query: `alternatives to ${query}`, why: `The opposing positions ${query} contends with.` },
      ];
    default:
      return [];
  }
}

function heuristicStudyMap(
  query: string,
  seedConcepts: Concept[],
  radius: number,
  qType: QueryType = 'topic',
): StudyMap {
  const budget = branchBudget(radius);
  const kinds = new Set(allowedKinds(radius));
  const queryWords = new Set(query.toLowerCase().split(/\s+/));
  const branches: StudyBranch[] = [];

  if (kinds.has('context')) {
    // Lead-up arc, widening with reach: the immediate backdrop first, broader
    // surrounding context as reach climbs. (The heuristic can't judge vitality
    // from a string, so it widens the net; the model path ranks properly.)
    const ctxQueries = [
      { concept: 'the immediate backdrop', q: `${query} background` },
      { concept: 'what led up to it', q: `${query} causes and background` },
      { concept: 'the surrounding context', q: `events surrounding ${query}` },
    ];
    for (const c of ctxQueries.slice(0, contextBudget(radius))) {
      branches.push({
        kind: 'context',
        concept: c.concept,
        query: c.q,
        why: `The backdrop “${query}” sits within — what was happening around and just before it.`,
      });
    }
  }
  // Deep-dive spine: the constituent principles a topic is BUILT FROM -- its 1D
  // idea-forms. For "a car engine" this reaches the engineness itself (how air moves
  // through it, how it handles heat, the thermodynamics), not just its parts. These
  // lead the queue and are reach-gated to deep/leaning-deep (mechanism/prerequisite
  // kinds), so a deep dive opens on how the thing fundamentally works.
  const deepReach = radius < 0.45; // deep dive + leaning deep only — other reaches already work well
  if (qType === 'topic' && deepReach && kinds.has('mechanism')) {
    branches.push({
      kind: 'mechanism',
      concept: 'how it works',
      query: `how ${query} works`,
      why: `The inner workings of “${query}” — the principles that make it do what it does.`,
    });
  }
  if (qType === 'topic' && deepReach && kinds.has('prerequisite')) {
    branches.push({
      kind: 'prerequisite',
      concept: 'what it’s built from',
      query: `${query} fundamental principles`,
      why: `The underlying forms “${query}” is built on — the deeper ideas it embodies.`,
    });
  }
  // Generic history/debate rungs for a plain topic; a person/event/philosophy
  // gets sharper, type-specific threads instead (below).
  if (qType === 'topic' && kinds.has('foundation')) {
    branches.push({
      kind: 'foundation',
      concept: `history of the idea`,
      query: `history of ${query}`,
      why: `Where “${query}” came from — the problems it was invented to solve.`,
    });
  }
  if (qType === 'topic' && kinds.has('frontier')) {
    branches.push({
      kind: 'frontier',
      concept: 'debates and criticism',
      query: `${query} criticism controversy`,
      why: `What experts argue about — the live edges of “${query}”.`,
    });
  }

  // Type-specific threads (person/event/philosophy) lead the queue ahead of
  // generic concept branches, each still gated by reach via its kind.
  for (const b of typeBranchSpecs(query, qType)) {
    if (branches.length >= budget) break;
    if (!kinds.has(b.kind)) continue;
    if (branches.some((x) => x.query.toLowerCase() === b.query.toLowerCase())) continue;
    branches.push(b);
  }

  // Concept branches: prefer specific multi-word terms and acronyms -- they
  // resolve to their own real articles ("machine learning"), where bare
  // common unigrams ("machine", "human") splinter the same ground.
  const branchScore = (c: Concept) =>
    c.weight * c.df * (c.id.includes(' ') || c.label === c.label.toUpperCase() ? 2.4 : 1);
  // Drop GENERIC BACKGROUND terms (single common words that recur across most of the
  // corpus, e.g. "science", "system") as branch candidates -- they're the backdrop, not
  // a specific neighbour, and researching them is what drifts a topic into general
  // science. Specific multi-word terms, acronyms, and mid-frequency words still qualify.
  const maxDf = Math.max(1, ...seedConcepts.map((c) => c.df));
  const genericBackground = (c: Concept) =>
    !c.id.includes(' ') && c.label !== c.label.toUpperCase() && c.df >= 0.5 * maxDf;
  const candidates = seedConcepts
    .filter((c) => c.important)
    .filter((c) => !c.id.split(' ').some((w) => queryWords.has(w)))
    .filter((c) => c.id.includes(' ') || c.label === c.label.toUpperCase() || c.id.length >= 5)
    .filter((c) => !genericBackground(c))
    .sort((a, b) => branchScore(b) - branchScore(a));
  // For a PERSON or EVENT, the subject's own facets (early life, work, criticism,
  // legacy — the type threads above) are what the learner asked for; co-occurring
  // terms (often other people) should fill only a little of the remainder, so the
  // session opens on the subject rather than veering into a tangential figure.
  const conceptCap = qType === 'person' || qType === 'event' ? 2 : budget;
  let conceptCount = 0;
  for (const c of candidates) {
    if (branches.length >= budget || conceptCount >= conceptCap) break;
    branches.push({
      kind: 'component',
      concept: c.label,
      query: c.label,
      why: `“${c.label}” recurs across your seed sources — gathering material that explains it in its own right.`,
    });
    conceptCount++;
  }

  return { idea: query, branches: branches.slice(0, budget), builtBy: 'heuristic' };
}

// -- endless frontier: each wave a fresh set of angles ------------------------
// At high reach the feed should never run dry. Each expansion wave gathers a
// NEW set of perspectives: rotating angle queries (different every wave) plus
// whatever concepts the weave itself has surfaced and not yet branched on. The
// near-duplicate merge (mergeResearch) discards anything already seen, so a
// wave that returns nothing new is the signal that the topic is truly mined out.

/** Rotating angle queries by type -- the perpetual-novelty bank. */
function angleTemplates(query: string, qType: QueryType): { kind: StudyBranch['kind']; concept: string; query: string }[] {
  switch (qType) {
    case 'person':
      return [
        { kind: 'frontier', concept: 'how contemporaries reacted', query: `reactions to ${query}` },
        { kind: 'application', concept: 'in popular culture', query: `${query} in popular culture` },
        { kind: 'context', concept: 'the world they lived in', query: `${query} era historical context` },
        { kind: 'frontier', concept: 'later years', query: `${query} later life death` },
        { kind: 'frontier', concept: 'how historians judge them', query: `historians on ${query}` },
        { kind: 'adjacent', concept: 'their circle', query: `${query} contemporaries associates` },
      ];
    case 'event':
      return [
        { kind: 'frontier', concept: 'eyewitness accounts', query: `${query} eyewitness accounts` },
        { kind: 'adjacent', concept: 'reaction abroad', query: `${query} international reaction` },
        { kind: 'application', concept: 'long-term effects', query: `${query} long-term consequences` },
        { kind: 'frontier', concept: 'myths and misconceptions', query: `${query} myths misconceptions` },
        { kind: 'foundation', concept: 'the wider conditions', query: `${query} underlying conditions` },
      ];
    case 'philosophy':
      return [
        { kind: 'application', concept: 'put into practice', query: `${query} in practice examples` },
        { kind: 'frontier', concept: 'its defenders', query: `defenses of ${query}` },
        { kind: 'frontier', concept: 'modern debates', query: `${query} contemporary debate` },
        { kind: 'foundation', concept: 'its key thinkers', query: `${query} key thinkers` },
        { kind: 'adjacent', concept: 'neighboring schools', query: `schools related to ${query}` },
      ];
    default:
      return [
        { kind: 'application', concept: 'where it shows up', query: `applications of ${query}` },
        { kind: 'frontier', concept: 'recent developments', query: `${query} recent developments` },
        { kind: 'frontier', concept: 'common misconceptions', query: `${query} misconceptions` },
        { kind: 'adjacent', concept: 'neighboring fields', query: `fields related to ${query}` },
        { kind: 'context', concept: 'how it came about', query: `${query} origins development` },
      ];
  }
}

/**
 * The next wave's study map: rotating angle queries (a different slice each
 * wave) plus emergent concepts the weave has surfaced, all reach-gated and
 * skipping anything already researched.
 */
export function buildExpansionMap(
  query: string,
  corpusConcepts: Concept[],
  qType: QueryType,
  radius: number,
  used: Set<string>,
  wave: number,
): StudyMap {
  const kinds = new Set(allowedKinds(radius));
  const budget = branchBudget(radius);
  const queryWords = new Set(query.toLowerCase().split(/\s+/));
  const branches: StudyBranch[] = [];

  // A rotating window over the angle bank so each wave opens different ground.
  const bank = angleTemplates(query, qType);
  for (let i = 0; i < bank.length; i++) {
    const t = bank[(wave + i) % bank.length];
    if (branches.length >= Math.ceil(budget / 2)) break;
    if (!kinds.has(t.kind) || used.has(t.query.toLowerCase())) continue;
    branches.push({ ...t, why: `Another angle on “${query}” — ${t.concept}.` });
  }

  // Emergent concepts: terms the weave keeps surfacing that have not yet been
  // branched on get their own real material now.
  const branchScore = (c: Concept) =>
    c.weight * c.df * (c.id.includes(' ') || c.label === c.label.toUpperCase() ? 2.4 : 1);
  const emergent = corpusConcepts
    .filter((c) => c.important && !used.has(c.label.toLowerCase()))
    .filter((c) => !c.id.split(' ').some((w) => queryWords.has(w)))
    .filter((c) => c.id.includes(' ') || c.label === c.label.toUpperCase() || c.id.length >= 5)
    .sort((a, b) => branchScore(b) - branchScore(a));
  for (const c of emergent) {
    if (branches.length >= budget) break;
    branches.push({
      kind: 'component',
      concept: c.label,
      query: c.label,
      why: `“${c.label}” keeps surfacing as you read — gathering material that explains it in its own right.`,
    });
  }

  return { idea: query, branches, builtBy: 'heuristic' };
}

/**
 * Build the study map: the configured model reads the seed material and
 * names the branches; any failure (no model, bad JSON, timeout) falls back
 * to the heuristic so the app never depends on AI being present.
 */
export async function buildStudyMap(
  query: string,
  seedPassages: Passage[],
  seedDocs: Map<string, SourceDoc>,
  seedConcepts: Concept[],
  radius: number,
  qType: QueryType = 'topic',
  onModelProgress?: (p: WebllmProgress) => void,
): Promise<StudyMap> {
  if (aiConfigured()) {
    const leads = seedPassages.slice(0, 4).map((p) => ({
      title: seedDocs.get(p.docId)?.title ?? 'source',
      text: p.text.slice(0, 600),
    }));
    const conceptLabels = seedConcepts
      .filter((c) => c.important)
      .slice(0, 24)
      .map((c) => c.label);
    const reply = await complete(STUDY_MAP_SYSTEM, studyMapUser(query, radius, conceptLabels, leads, qType), {
      maxTokens: 1200,
      onProgress: onModelProgress,
    });
    if (reply) {
      const map = sanitizeModelMap(extractJson<RawMap>(reply), query, radius);
      if (map) return map;
    }
  }
  return heuristicStudyMap(query, seedConcepts, radius, qType);
}

// -- researching the branches -------------------------------------------------

/**
 * Gather real sources for each branch (in parallel, best-effort) and tag
 * every doc with the branch it serves, so cards can say WHY this material
 * was pulled into the weave.
 */
export async function researchBranches(
  map: StudyMap,
  radius: number,
  onProgress: ProgressFn,
  qType: QueryType = 'topic',
): Promise<BranchResearch> {
  const deepKinds = new Set(['context', 'mechanism', 'frontier', 'foundation']);
  // Outward-facing branch kinds where extra perspectives genuinely add angles
  // (a mechanism branch wants the textbook, not period newspapers).
  const angleKinds = new Set(['context', 'application', 'foundation', 'frontier', 'adjacent']);
  // Crawl depth tracks reach (the same dial that decides "branch out"). DEEP
  // DIVE reads each branch source far further -- more of its pages and more
  // passages from each, plus papers for the inward kinds -- so a few threads
  // are mastered in depth. FRONTIER spreads thinner across many branches but
  // pulls papers widely, for angles rather than depth.
  const deepDive = radius < 0.4;
  const branchPages = deepDive ? 2 : 1;
  const branchPassages = deepDive ? 9 : 5;
  const paperCount = deepDive ? 2 : 1;
  const results = await Promise.all(
    map.branches.map(async (branch): Promise<BranchResearch> => {
      const name = `↳ ${branch.concept}`;
      onProgress({ name, status: 'pending', passages: 0 });
      try {
        // Pull papers for the inward/foundational kinds when diving deep, and
        // broadly once reach climbs (frontier wants every scholarly angle).
        const wantPapers = (deepKinds.has(branch.kind) && radius >= 0.34) || radius >= 0.6;
        const empty = Promise.resolve({ docs: [] as SourceDoc[], passages: [] as Passage[] });
        // Entity-aware angles, gated by reach so deep dives stay tight. A PERSON
        // or EVENT branch pulls reporting across eras -- Wikinews and Chronicling
        // America (keyless), plus The Guardian and NYT when keys are set -- for
        // "the story across time", plus modern DISCUSSION (Hacker News) as its
        // own distinct angle, never a stand-in for news. A PHILOSOPHY branch
        // pulls long-form / primary text (Internet Archive) so a rival or critic
        // gets to talk at length. (Keyed providers no-op without a key.)
        const angle = angleKinds.has(branch.kind) && radius >= 0.5;
        const wantNews = angle && (qType === 'person' || qType === 'event');
        const wantArchive = angle && (qType === 'philosophy' || qType === 'event');
        const [wiki, papers, histNews, modNews, guardian, nyt, talk, archive] = await Promise.all([
          searchWiki(branch.query, 'en.wikipedia.org', 'encyclopedia', 'Wikipedia', branchPages, branchPassages),
          wantPapers ? searchOpenAlex(branch.query, paperCount) : empty,
          wantNews ? searchChronicling(branch.query, 2) : empty,
          wantNews ? searchWiki(branch.query, 'en.wikinews.org', 'news', 'Wikinews', 2, 3) : empty,
          wantNews ? searchGuardian(branch.query, 4) : empty,
          wantNews ? searchNYT(branch.query) : empty,
          wantNews ? searchHN(branch.query, 3) : empty,
          wantArchive ? searchArchive(branch.query, 1, 3) : empty,
        ]);
        const docs = [
          ...wiki.docs,
          ...papers.docs,
          ...histNews.docs,
          ...modNews.docs,
          ...guardian.docs,
          ...nyt.docs,
          ...talk.docs,
          ...archive.docs,
        ];
        for (const doc of docs) {
          doc.branch = { kind: branch.kind, concept: branch.concept, why: branch.why };
        }
        const passages = [
          ...wiki.passages,
          ...papers.passages,
          ...histNews.passages,
          ...modNews.passages,
          ...guardian.passages,
          ...nyt.passages,
          ...talk.passages,
          ...archive.passages,
        ];
        onProgress({ name, status: 'ok', passages: passages.length });
        return { docs, passages };
      } catch {
        onProgress({ name, status: 'fail', passages: 0 });
        return { docs: [], passages: [] };
      }
    }),
  );
  const docs: SourceDoc[] = [];
  const passages: Passage[] = [];
  for (const r of results) {
    docs.push(...r.docs);
    passages.push(...r.passages);
  }
  return { docs, passages };
}

/**
 * Merge branch material into the seed corpus: a branch doc that is the same
 * page a seed provider already found is dropped (url match), and a branch
 * passage that restates a kept passage is dropped (same near-duplicate test
 * the seed merge uses). Seed material wins ties -- branches widen, never
 * displace.
 */
export function mergeResearch(
  seed: { docs: SourceDoc[]; passages: Passage[] },
  branch: BranchResearch,
  maxTotalPassages: number,
): { docs: SourceDoc[]; passages: Passage[] } {
  const seenUrls = new Set(seed.docs.map((d) => d.url));
  const keptDocs = [...seed.docs];
  const liveBranchDocs = new Set<string>();
  for (const doc of branch.docs) {
    if (seenUrls.has(doc.url)) continue;
    seenUrls.add(doc.url);
    keptDocs.push(doc);
    liveBranchDocs.add(doc.id);
  }

  const keptWordSets = seed.passages.map((p) => wordSet(p.text));
  const keptPassages = [...seed.passages];
  for (const passage of branch.passages) {
    if (keptPassages.length >= maxTotalPassages) break;
    if (!liveBranchDocs.has(passage.docId)) continue;
    const words = wordSet(passage.text);
    if (keptWordSets.some((kept) => nearDuplicate(words, kept))) continue;
    keptWordSets.push(words);
    keptPassages.push(passage);
  }

  const liveDocIds = new Set(keptPassages.map((p) => p.docId));
  return { docs: keptDocs.filter((d) => liveDocIds.has(d.id)), passages: keptPassages };
}
