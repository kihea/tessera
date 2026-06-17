// The Loom: plans the feed ONE card at a time against live state. This is a
// direct adaptation of TestApp's engine Stage C (assembler.ts):
//
//   engine                      tessera
//   ------------------------    -----------------------------------------
//   KU prerequisite graph    -> concept co-occurrence across real sources
//   technique interleave     -> source-type interleave (no 3 alike in a row)
//   novelty injection        -> each card should introduce 1-3 new concepts
//   spaced "due" reviews     -> hot terms get grounded (corpus definition
//                               first, Wiktionary only as fallback) AND
//                               recalled via checks for understanding
//   boss-fight checks        -> two GATE kinds the learner must clear before
//                               the feed continues: weave checkpoints (write
//                               the connection in your own words -- Socratic)
//                               and checks for understanding (cloze / MCQ
//                               recall drawn from the actual content)
//   Iceberg layers L0..L4    -> passage depth rungs 0..3 (weave/depth.ts);
//                               the loom tracks a live mastery stage and
//                               targets material one nudge AHEAD of it
//   reason strings           -> every card says why it was chosen NOW
//
// The scoring is Aristotelian by construction: a card is valuable in
// proportion to how strongly it CONNECTS to what has already been seen while
// still opening a small number of new threads -- the form is built from the
// material. Isolated information scores poorly no matter how good it looks
// on its own. (The gates, where the learner answers / synthesizes themselves,
// are the Socratic part.)

import type {
  CheckCard,
  CheckpointCard,
  Concept,
  Corpus,
  DefinitionCard,
  EndCard,
  FeedCard,
  FormulaCard,
  Passage,
  PassageCard,
  SourceDoc,
  SourceType,
  Thread,
} from '../types';
import { hasContrastCue, threadKind } from './connections';
import { DEPTH_LABEL, depthRung } from './depth';
import type { DepthRung } from './depth';
import { buildCheck, mentionsAnswer } from './checks';
import type { TypeBandit } from './bandit';
import type { Opening } from '../types';
import { DEFAULT_WEIGHTS } from './weights';
import type { WeaveWeights } from './weights';

export interface LoomOptions {
  /** Weave-checkpoint cadence (onboarding preference). */
  checkpointEvery: number;
  /** How the session opens: ground-up, into the debate, or balanced. */
  opening: Opening;
}

const DEFAULT_OPTIONS: LoomOptions = { checkpointEvery: 6, opening: 'balanced' };

interface Emitted {
  cardId: string;
  cardIndex: number;
}

// -- Socratic prompt banks. Open, pointed, opinion-forming -- never the broad
// "how does A relate to B" (which pins down no reasoning). {a}/{b} are threads.
// Every template must read correctly whether the label is singular or plural
// ("messages", "interest rates"), so the labels never sit as a verb's subject.
const WEAVE_PROMPTS: ((a: string, b: string) => string)[] = [
  (a, b) => `If ${a} changed, what would happen to ${b}?`,
  (a, b) => `Why is the link between ${a} and ${b} central to this topic?`,
  (a, b) => `What would ${b} look like without ${a}?`,
  (a, b) => `What does the pairing of ${a} and ${b} explain that neither explains alone?`,
  (a, b) => `Trace the line from ${a} to ${b}: what has to hold for one to lead to the other?`,
  (a, b) => `Which is doing more of the work here — ${a} or ${b} — and why do you think so?`,
];
const CONTRAST_PROMPTS: ((a: string, b: string) => string)[] = [
  (a, b) => `Your sources pull ${a} and ${b} in different directions — which reading convinces you, and why?`,
  (a, b) => `Where exactly do ${a} and ${b} disagree, and what is at stake in that disagreement?`,
  (a, b) => `Is the tension between ${a} and ${b} real, or a matter of framing? Argue your side.`,
];

/** Trivially-related pairs make weak checkpoints: substrings or shared words. */
function trivialPair(a: Concept, b: Concept): boolean {
  const la = a.label.toLowerCase();
  const lb = b.label.toLowerCase();
  if (la.includes(lb) || lb.includes(la)) return true;
  const wa = new Set(a.id.split(' '));
  if (b.id.split(' ').some((w) => wa.has(w))) return true;
  // An acronym and its expansion are ONE thread, not two: "DFT" must never be
  // weighed against "discrete fourier". Initials of the multi-word label
  // matching the head of the short uppercase one marks them equivalent.
  const acronymish = (label: string) => label === label.toUpperCase() && !label.includes(' ') && label.length <= 5;
  const initials = (id: string) => id.split(' ').map((w) => w[0]).join('');
  if (acronymish(a.label) && b.id.includes(' ')) {
    const ini = initials(b.id);
    if (la.startsWith(ini) || ini.startsWith(la)) return true;
  }
  if (acronymish(b.label) && a.id.includes(' ')) {
    const ini = initials(a.id);
    if (lb.startsWith(ini) || ini.startsWith(lb)) return true;
  }
  return false;
}

export class Loom {
  private position = 0; // passages emitted (drives depth targeting)
  private emitted = new Map<string, Emitted>(); // passageId -> card ref
  private exposure = new Map<string, number>(); // conceptId -> times surfaced
  private definedSeen = new Set<string>(); // concepts grounded (corpus or ref card)
  private formulaEmitted = new Set<string>(); // formula ids already shown
  private formulaConcepts = new Set<string>(); // concepts already given a formula
  private excludedDocs = new Set<string>(); // reported sources -- never pick again
  private checkpointed = new Set<string>(); // "a|b" concept pairs
  private checkpointUse = new Map<string, number>(); // conceptId -> times woven (diversify)
  private checkedConcepts = new Set<string>(); // concepts already quizzed
  private checksEmitted = 0; // to alternate cloze / multiple-choice
  private docCounts = new Map<string, number>();
  private lastType: SourceType | null = null;
  private typeStreak = 0;
  private sinceCheckpoint = 0;
  private sinceCheck = 0;
  private cardsSinceGate = 99; // allow an early gate once warmed up
  private lastKind: FeedCard['kind'] | null = null;
  private cardSeq = 0;
  private wovenCount = 0; // checkpoints the learner actually inserted
  private lastRung: DepthRung = 0;
  // -- cohesion: reading a source as a coherent stretch ---------------------
  private lastDocId: string | null = null;
  private docLastIndex = new Map<string, number>(); // docId -> last emitted passage index
  private sameDocRun = 0; // consecutive in-order cards from the current doc
  private chainDocId: string | null = null; // doc of an active deep-dive run
  private chainRemaining = 0; // contiguous cards still owed to that run
  private cardsSinceChain = 99; // spacing between deep-dive runs (warm-start high)
  private spineConcepts = new Set<string>(); // concepts central to the main idea
  // -- contextualize: a short lead-up on-ramp before the trunk ---------------
  private contextDone = false; // the opening context run has finished
  private contextEmitted = 0; // context cards emitted in that run
  private handoffPending = false; // mark the first trunk card with a handoff line
  private videoCardsEmitted = 0; // embed cards surfaced so far (capped by weights)
  private readonly checkEvery: number;

  constructor(
    private corpus: Corpus,
    private bandit: TypeBandit,
    private opts: LoomOptions = DEFAULT_OPTIONS,
    private w: WeaveWeights = DEFAULT_WEIGHTS,
  ) {
    // Checks are the lighter, more frequent gate; checkpoints the rarer deep one.
    this.checkEvery = Math.max(3, Math.round(this.opts.checkpointEvery * 0.6));
    // Spine concepts: central to the main idea -- frequent AND spread across
    // many independent sources (real structure, not one source's vocabulary).
    // A monumental deep-dive run is only worth firing for one of these.
    const docOf = (pid: string) => this.corpus.passages.find((p) => p.id === pid)?.docId;
    const docSpread = (c: Concept) =>
      new Set(c.passageIds.map(docOf).filter((d): d is string => !!d)).size;
    this.spineConcepts = new Set(
      [...this.corpus.concepts]
        .filter((c) => c.important)
        .sort((a, b) => b.df - a.df)
        .slice(0, this.w.chainSpineTopN)
        .filter((c) => docSpread(c) >= this.w.chainSpineMinDocs)
        .map((c) => c.id),
    );
  }

  /**
   * The learner's current mastery stage, read from the weave itself: how much
   * of the topic's recurring structure has been surfaced, recurred, grounded
   * -- and how many connections the learner has WOVEN in their own words.
   * Completing checkpoints is the strongest evidence and literally advances
   * the ladder.
   */
  stage(): { score: number; rung: DepthRung; label: string } {
    const top = [...this.corpus.concepts].sort((a, b) => b.df - a.df).slice(0, 12);
    if (top.length === 0) return { score: 0, rung: 0, label: DEPTH_LABEL[0] };
    const frac = (test: (id: string) => boolean) => top.filter((c) => test(c.id)).length / top.length;
    const exposed = frac((id) => (this.exposure.get(id) ?? 0) >= 1);
    const recurred = frac((id) => (this.exposure.get(id) ?? 0) >= 3);
    // Grounding is judged against the concepts that CAN be grounded (a corpus
    // passage defines them, or a reference entry exists); when none can, that
    // component drops out entirely rather than auto-maxing. The weights lean
    // on the SLOW signals -- recurrence and woven checkpoints -- because mere
    // exposure saturates within a few cards and would race the ladder.
    const groundable = top.filter((c) => c.definedByPassage || c.definition);
    const woven = Math.min(1, this.wovenCount / 3);
    const parts: [number, number][] = [
      [0.25, exposed],
      [0.3, recurred],
      [0.25, woven],
    ];
    if (groundable.length > 0) {
      parts.push([0.2, groundable.filter((c) => this.definedSeen.has(c.id)).length / groundable.length]);
    }
    const totalW = parts.reduce((s, [w]) => s + w, 0);
    const score = parts.reduce((s, [w, v]) => s + w * v, 0) / totalW;
    return { score, rung: depthRung(score * 3), label: DEPTH_LABEL[depthRung(score * 3)] };
  }

  /** The learner completed a weave checkpoint -- real synthesis, advance the ladder. */
  noteCheckpointWoven(): void {
    this.wovenCount += 1;
  }

  /** The learner reported this source -- its remaining excerpts never surface. */
  excludeDoc(docId: string): void {
    this.excludedDocs.add(docId);
  }

  private conceptById(id: string): Concept | undefined {
    return this.corpus.concepts.find((c) => c.id === id);
  }

  private conceptsOf(passage: Passage): Concept[] {
    return this.corpus.concepts.filter((c) => c.passageIds.includes(passage.id));
  }

  private nextId(): { id: string; index: number } {
    this.cardSeq += 1;
    return { id: `card-${this.cardSeq}`, index: this.cardSeq };
  }

  private recency(concept: Concept): number {
    let r = 0;
    for (const pid of concept.passageIds) {
      const e = this.emitted.get(pid);
      if (e) r = Math.max(r, e.cardIndex);
    }
    return r;
  }

  /** Plan the single next card, or an end card when the weave is exhausted. */
  next(): FeedCard | null {
    // Open with a short lead-up context run, then hand off to the trunk.
    const context = this.maybeContext();
    if (context) return context;

    // A monumental deep-dive runs uninterrupted -- even gates wait a few cards.
    const chain = this.maybeChainContinue();
    if (chain) return chain;

    const checkpoint = this.maybeCheckpoint();
    if (checkpoint) return checkpoint;

    const check = this.maybeCheck();
    if (check) return check;

    const definition = this.maybeDefinition();
    if (definition) return definition;

    const formula = this.maybeFormula();
    if (formula) return formula;

    const passageCard = this.pickPassage();
    if (passageCard) return passageCard;

    if (this.lastKind === 'end') return null;
    const { id, index } = this.nextId();
    this.lastKind = 'end';
    const end: EndCard = { kind: 'end', id, index };
    return end;
  }

  // -- weave checkpoints (Socratic synthesis) -------------------------------

  private maybeCheckpoint(): CheckpointCard | null {
    if (this.position === 0 || this.cardsSinceGate < 2) return null;
    if (this.sinceCheckpoint < this.opts.checkpointEvery) return null;
    const exposed = this.corpus.concepts.filter(
      (c) => c.important && (this.exposure.get(c.id) ?? 0) >= 2,
    );
    if (exposed.length < 2) return null;

    let best: { a: Concept; b: Concept; score: number; together: number } | null = null;
    for (let i = 0; i < exposed.length; i++) {
      for (let j = i + 1; j < exposed.length; j++) {
        const a = exposed[i];
        const b = exposed[j];
        if (this.checkpointed.has([a.id, b.id].sort().join('|'))) continue;
        if (trivialPair(a, b)) continue;
        const together = a.passageIds.filter(
          (pid) => b.passageIds.includes(pid) && this.emitted.has(pid),
        ).length;
        const minExp = Math.min(this.exposure.get(a.id) ?? 0, this.exposure.get(b.id) ?? 0);
        const reuse = (this.checkpointUse.get(a.id) ?? 0) + (this.checkpointUse.get(b.id) ?? 0);
        // Target a REAL connection (they co-occur in seen passages), drawn from
        // RECENT cards, between threads not already woven to death. The reuse
        // penalty is what stops "card 1 & card 13, card 1 & card 24, ...".
        const score =
          minExp +
          this.w.checkpointTogetherWeight * together +
          this.w.checkpointRecencyWeight * (this.recency(a) + this.recency(b)) -
          this.w.checkpointReusePenalty * reuse;
        if (!best || score > best.score) best = { a, b, score, together };
      }
    }
    // Require a genuine connection: co-occurrence, or (fallback) two strongly
    // recurring threads. Never just "the two most frequent words".
    if (!best || (best.together === 0 && best.score < 5)) return null;

    const quoteFor = (concept: Concept, avoidDoc?: string): Passage | null => {
      let pick: Passage | null = null;
      let pickScore = -Infinity;
      for (const pid of concept.passageIds) {
        const e = this.emitted.get(pid);
        if (!e) continue;
        const passage = this.corpus.passages.find((p) => p.id === pid)!;
        const s = e.cardIndex - (avoidDoc && passage.docId === avoidDoc ? 1000 : 0);
        if (s > pickScore) {
          pickScore = s;
          pick = passage;
        }
      }
      return pick;
    };
    const pa = quoteFor(best.a);
    const pb = quoteFor(best.b, pa?.docId);
    if (!pa || !pb || pa.id === pb.id) return null;
    const docA = this.corpus.docs.get(pa.docId)!;
    const docB = this.corpus.docs.get(pb.docId)!;

    this.checkpointed.add([best.a.id, best.b.id].sort().join('|'));
    this.checkpointUse.set(best.a.id, (this.checkpointUse.get(best.a.id) ?? 0) + 1);
    this.checkpointUse.set(best.b.id, (this.checkpointUse.get(best.b.id) ?? 0) + 1);
    this.sinceCheckpoint = 0;
    this.cardsSinceGate = 0;
    this.lastKind = 'checkpoint';

    const contrast = hasContrastCue(pa.text) || hasContrastCue(pb.text);
    const bank = contrast ? CONTRAST_PROMPTS : WEAVE_PROMPTS;
    const prompt = bank[this.checkpointed.size % bank.length](best.a.label, best.b.label);

    const { id, index } = this.nextId();
    return {
      kind: 'checkpoint',
      id,
      index,
      conceptA: best.a.id,
      conceptB: best.b.id,
      labelA: best.a.label,
      labelB: best.b.label,
      prompt,
      quoteA: { text: pa.text, title: docA.title, url: pa.anchorUrl ?? docA.url },
      quoteB: { text: pb.text, title: docB.title, url: pb.anchorUrl ?? docB.url },
      cardRefA: this.emitted.get(pa.id)!.cardIndex,
      cardRefB: this.emitted.get(pb.id)!.cardIndex,
      reason: contrast
        ? `Your sources disagree about these threads — stake out your own reading before moving on.`
        : `Both threads keep recurring across your sources — time to weave them yourself.`,
    };
  }

  // -- checks for understanding (recall drawn from real content) ------------

  private maybeCheck(): CheckCard | null {
    if (this.position < 2 || this.cardsSinceGate < 2) return null;
    if (this.sinceCheck < this.checkEvery) return null;

    // Draw from a RECENTLY seen passage (so it's genuine recall, not copying
    // the card above). Walk most-recent-first within a short window.
    const recent = [...this.emitted.entries()]
      .map(([pid, e]) => ({ passage: this.corpus.passages.find((p) => p.id === pid)!, e }))
      .filter((x) => x.passage && this.cardSeq - x.e.cardIndex >= 1 && this.cardSeq - x.e.cardIndex <= 9)
      .sort((a, b) => b.e.cardIndex - a.e.cardIndex);

    // First check eases in as recognition (mcq); then alternate with recall (cloze).
    const preferCloze = this.checksEmitted % 2 === 1;
    for (const { passage, e } of recent) {
      const built = buildCheck(passage, this.corpus.concepts, this.exposure, this.checkedConcepts, preferCloze);
      if (!built) continue;
      const doc = this.corpus.docs.get(passage.docId)!;
      this.checkedConcepts.add(built.conceptId);
      this.checksEmitted += 1;
      this.sinceCheck = 0;
      this.cardsSinceGate = 0;
      this.lastKind = 'check';
      const { id, index } = this.nextId();
      // NEVER name (or even echo a word of) the answer here.
      let reason = `Quick check on card ${e.cardIndex} — can you restore the missing thread from memory?`;
      if (mentionsAnswer(reason, built.conceptLabel)) reason = `A recall gate for card ${e.cardIndex}.`;
      return {
        kind: 'check',
        id,
        index,
        format: built.format,
        instruction: built.instruction,
        blanked: built.blanked,
        answer: built.answer,
        accept: built.accept,
        options: built.options,
        conceptId: built.conceptId,
        conceptLabel: built.conceptLabel,
        sourceType: doc.sourceType,
        cardRef: e.cardIndex,
        sourceTitle: doc.title,
        reason,
      };
    }
    return null;
  }

  // -- fallback definitions ---------------------------------------------------

  private maybeDefinition(): DefinitionCard | null {
    if (this.lastKind === 'definition') return null;
    for (const concept of this.corpus.concepts) {
      if (!concept.important) continue; // never define generic filler
      const hot = (this.exposure.get(concept.id) ?? 0) >= this.w.hotExposure;
      if (!hot || this.definedSeen.has(concept.id)) continue;
      // Corpus material wins: if some passage defines it, let scoring surface
      // that passage instead of importing an outside definition.
      if (concept.definedByPassage && !this.emitted.has(concept.definedByPassage)) continue;
      if (!concept.definition) continue;
      this.definedSeen.add(concept.id);
      this.exposure.set(concept.id, (this.exposure.get(concept.id) ?? 0) + 1);
      this.lastKind = 'definition';
      this.sinceCheckpoint += 1;
      this.sinceCheck += 1;
      this.cardsSinceGate += 1;
      const { id, index } = this.nextId();
      return {
        kind: 'definition',
        id,
        index,
        conceptId: concept.id,
        label: concept.label,
        definition: concept.definition.text,
        url: concept.definition.url,
        source: concept.definition.source,
        reason: `You have met “${concept.label}” ${this.exposure.get(concept.id)! - 1} times — none of your sources pin it down, so here is the reference entry.`,
      };
    }
    return null;
  }

  // -- formulas (the mathematics itself, from the source's own markup) --------

  private maybeFormula(): FormulaCard | null {
    if (this.position < 2 || this.lastKind === 'formula') return null;
    if (this.formulaEmitted.size >= this.w.maxFormulas) return null;
    for (const f of this.corpus.formulas) {
      if (this.formulaEmitted.has(f.id)) continue;
      // The formula fires when a thread it grounds has gone hot -- the learner
      // has met the term repeatedly; now they see the equation behind it.
      const hot = f.conceptIds
        .map((id) => this.conceptById(id))
        .filter(
          (c): c is Concept =>
            !!c &&
            c.important === true &&
            (this.exposure.get(c.id) ?? 0) >= this.w.hotExposure &&
            !this.formulaConcepts.has(c.id),
        )
        .sort((a, b) => (this.exposure.get(b.id) ?? 0) - (this.exposure.get(a.id) ?? 0));
      const concept = hot[0];
      if (!concept) continue;

      this.formulaEmitted.add(f.id);
      this.formulaConcepts.add(concept.id);
      this.exposure.set(concept.id, (this.exposure.get(concept.id) ?? 0) + 1);
      this.lastKind = 'formula';
      this.sinceCheckpoint += 1;
      this.sinceCheck += 1;
      this.cardsSinceGate += 1;
      const { id, index } = this.nextId();
      return {
        kind: 'formula',
        id,
        index,
        conceptId: concept.id,
        label: concept.label,
        latex: f.latex,
        svgUrl: f.svgUrl,
        caption: f.caption,
        section: f.section,
        context: f.context,
        sourceTitle: f.sourceTitle,
        url: f.url,
        reason: f.caption
          ? `“${concept.label}” keeps recurring — ${f.sourceTitle} writes its “${f.caption}” like this.`
          : `“${concept.label}” keeps recurring — this is the mathematics behind it, exactly as ${f.sourceTitle} writes it.`,
      };
    }
    return null;
  }

  // -- contextualize: lead-up on-ramp ---------------------------------------
  // At session open, emit a short run of "context" branch passages (the lead-up
  // the idea sits downstream of -- causes before the War of 1812, Calc 1 before
  // Calc 2), shallow-first and bridging toward the spine, then hand off to the
  // trunk. Self-terminates and never fires again; with no context sources it is
  // a no-op and the feed behaves exactly as before.
  private maybeContext(): PassageCard | null {
    if (this.contextDone) return null;
    const candidates = this.corpus.passages.filter(
      (p) =>
        !this.emitted.has(p.id) &&
        !this.excludedDocs.has(p.docId) &&
        this.corpus.docs.get(p.docId)?.branch?.kind === 'context',
    );
    if (candidates.length === 0 || this.contextEmitted >= this.w.contextRunLen) {
      this.contextDone = true;
      if (this.contextEmitted > 0) this.handoffPending = true; // bridge into the trunk
      return null;
    }
    // The study map lists context branches in priority order (most immediate
    // first); lead with those so the on-ramp opens on the closest backdrop.
    const ctxBranches = (this.corpus.studyMap?.branches ?? []).filter((b) => b.kind === 'context');
    const immediacy = (concept?: string) => {
      const i = ctxBranches.findIndex((b) => b.concept === concept);
      return i < 0 ? 0 : 1 - i / Math.max(1, ctxBranches.length);
    };
    let best: { passage: Passage; doc: SourceDoc; score: number } | null = null;
    for (const passage of candidates) {
      const doc = this.corpus.docs.get(passage.docId)!;
      const depth = passage.depth ?? 1;
      let score = 1.6 - depth; // shallow on-ramp first
      // most-immediate lead-up leads the run
      score += 0.5 * immediacy(doc.branch?.concept);
      // bridge toward the main idea: context that touches spine concepts leads in
      score += 0.35 * this.conceptsOf(passage).filter((c) => this.spineConcepts.has(c.id)).length;
      // read a context source in order, and prefer a source's own opening
      if (
        passage.docId === this.lastDocId &&
        passage.index === (this.docLastIndex.get(passage.docId) ?? -1) + 1
      )
        score += 0.6;
      if (passage.index === 0) score += 0.2;
      if (!best || score > best.score) best = { passage, doc, score };
    }
    if (!best) {
      this.contextDone = true;
      return null;
    }
    this.contextEmitted += 1;
    return this.emitPassage(best.passage, best.doc, this.currentTarget(), false, true);
  }

  // -- monumental deep-dive chain -------------------------------------------
  // When a spine concept goes hot, occasionally read ONE source straight on for
  // a few cards (document order, uninterrupted) so a thread central to the main
  // idea lands as a coherent stretch instead of scattered splices.

  /** The unseen passage of `docId` that comes next in document order, if any. */
  private nextInOrder(docId: string): Passage | null {
    const last = this.docLastIndex.get(docId) ?? -1;
    let best: Passage | null = null;
    for (const p of this.corpus.passages) {
      if (p.docId !== docId || this.emitted.has(p.id) || this.excludedDocs.has(p.docId)) continue;
      if (p.index <= last) continue;
      if (!best || p.index < best.index) best = p;
    }
    return best;
  }

  /** If a deep-dive run is active, emit its next contiguous passage. */
  private maybeChainContinue(): PassageCard | null {
    if (this.chainRemaining <= 0 || !this.chainDocId) return null;
    const passage = this.nextInOrder(this.chainDocId);
    if (!passage || (this.docCounts.get(this.chainDocId) ?? 0) >= this.w.maxPerDoc) {
      this.chainRemaining = 0;
      this.chainDocId = null;
      return null;
    }
    this.chainRemaining -= 1;
    const doc = this.corpus.docs.get(passage.docId)!;
    return this.emitPassage(passage, doc, this.currentTarget(), true);
  }

  /** Start a deep-dive when the just-emitted passage put a spine concept in play. */
  private maybeStartChain(passage: Passage): void {
    if (!this.w.chainEnabled || this.chainRemaining > 0) return;
    // Never deep-dive a context (lead-up) source -- the on-ramp stays short.
    if (this.corpus.docs.get(passage.docId)?.branch?.kind === 'context') return;
    if (this.cardsSinceChain < this.w.chainEveryCards || this.position < this.w.chainMinPosition) return;
    if ((this.docCounts.get(passage.docId) ?? 0) >= this.w.maxPerDoc) return;
    const covers = this.conceptsOf(passage).some((c) => this.spineConcepts.has(c.id));
    if (!covers || !this.nextInOrder(passage.docId)) return;
    this.chainDocId = passage.docId;
    this.chainRemaining = Math.max(0, this.w.chainLen - 1); // this card is the run's first
    this.cardsSinceChain = 0;
  }

  /** Where the ladder points now: the live stage nudged ~half a rung ahead. */
  private currentTarget(): number {
    let target = Math.min(3, this.stage().score * 3 + 0.45);
    if (this.opts.opening === 'ground') target = Math.max(0, target - 0.35);
    return target;
  }

  // -- passages ---------------------------------------------------------------

  private pickPassage(): PassageCard | null {
    const videoFull = this.videoCardsEmitted >= this.w.maxVideoCards;
    const candidates = this.corpus.passages.filter(
      (p) =>
        !this.emitted.has(p.id) &&
        !this.excludedDocs.has(p.docId) &&
        !(videoFull && this.corpus.docs.get(p.docId)?.sourceType === 'video'),
    );
    if (candidates.length === 0) return null;

    // Where the ladder points right now: the learner's live stage, nudged
    // ~half a rung AHEAD so the feed always pulls toward mastery rather than
    // circling what is already comfortable.
    const target = this.currentTarget();

    // Pass 0 enforces every soft constraint; pass 1 relaxes them (engine-style).
    for (let pass = 0; pass < 2; pass++) {
      let best: { passage: Passage; doc: SourceDoc; score: number } | null = null;
      for (const passage of candidates) {
        const doc = this.corpus.docs.get(passage.docId)!;
        const concepts = this.conceptsOf(passage);
        const fresh = concepts.filter((c) => (this.exposure.get(c.id) ?? 0) === 0);

        // Are we reading this exact source straight on (its next paragraph)?
        const inOrder =
          passage.docId === this.lastDocId &&
          passage.index === (this.docLastIndex.get(passage.docId) ?? -1) + 1;

        const depth = passage.depth ?? 1;
        if (pass === 0) {
          if ((this.docCounts.get(passage.docId) ?? 0) >= this.w.maxPerDoc) continue;
          // Type-streak guards cross-doc variety, but a source we're actively
          // reading in order may continue past it, up to maxSameDocRun.
          const continuingDoc = inOrder && this.sameDocRun < this.w.maxSameDocRun;
          if (
            doc.sourceType === this.lastType &&
            this.typeStreak >= this.w.maxTypeStreak &&
            !continuingDoc
          )
            continue;
          if (
            this.position > 2 &&
            concepts.length > 0 &&
            fresh.length === 0 &&
            concepts.length < 4 &&
            !inOrder
          )
            continue;
          // Material more than a rung above the learner's stage WAITS -- a
          // paper abstract at card 6 defeats the whole ladder. (Debate-opening
          // learners asked for early disagreement, so discussions are exempt.)
          const exemptDebate = this.opts.opening === 'debate' && doc.sourceType === 'discussion';
          if (!exemptDebate && depth - target > 1.0) continue;
        }

        let score = 0;
        // Connection to the seen weave: the Aristotelian term. Familiar
        // concepts count more the more often they have recurred (up to a cap).
        for (const c of concepts) {
          const exp = this.exposure.get(c.id) ?? 0;
          if (exp > 0) score += this.w.connectionWeight * c.weight * (Math.min(exp, 3) / 3);
        }
        // Mastery fit: an excerpt is curated FOR the current stage, and the
        // penalty is ASYMMETRIC -- reaching above the stage costs much more
        // than revisiting below it, so deep material holds until the ladder
        // earns it, then basics stop recirculating.
        const gap = depth - target;
        score +=
          this.w.masteryFitBase -
          (gap > 0 ? this.w.masteryAbovePenalty * gap : this.w.masteryBelowPenalty * -gap);
        // Frontier push: at the mastery stage the feed should TACKLE the deep
        // material -- criticism, scholarship, primary texts -- not keep
        // circling well-connected mid-rung passages.
        if (target >= 2.4 && depth >= 2.4) score += this.w.frontierPush;
        // Novelty window: open a few new threads, never a flood.
        if (this.position === 0) {
          score += concepts.some((c) => c.definedByPassage === passage.id) ? 0.9 : 0;
          score += passage.index === 0 ? 0.3 : 0;
          // The session opens on the trunk: branch material earns its place
          // once the main idea has a foothold, not before.
          if (doc.branch) score -= 0.8;
        } else if (fresh.length === 0) {
          score -= this.w.noveltyNonePenalty;
        } else if (fresh.length <= 3) {
          score += this.w.noveltyFewBonus;
        } else {
          score += this.w.noveltyFewBonus - this.w.noveltyManyPenalty * (fresh.length - 3);
        }
        // Cohesion: reward continuing the current source in document order, so a
        // source unfolds as a stretch instead of scattering across the feed.
        if (inOrder) score += this.w.continueInOrderBonus;
        // Opening preference (onboarding): ground-up favors definitional
        // material early; into-the-debate pulls contrasting voices forward.
        if (this.opts.opening === 'ground' && this.position < 4) {
          if (concepts.some((c) => c.definedByPassage === passage.id)) score += 0.5;
        }
        if (this.opts.opening === 'debate' && this.position >= 1 && this.position < 6) {
          if (doc.sourceType === 'discussion') score += 0.55;
          if (hasContrastCue(passage.text)) score += 0.35;
        }
        // A passage that grounds a hot, still-undefined term is exactly what
        // the engine's "due review" was: surface it now.
        if (
          concepts.some(
            (c) =>
              c.definedByPassage === passage.id &&
              (this.exposure.get(c.id) ?? 0) >= 2 &&
              !this.definedSeen.has(c.id),
          )
        ) {
          score += this.w.dueReviewBonus;
        }
        // Learned source-type preference nudges, never dictates, and only
        // once the opening of the weave is established.
        if (this.position >= 3) score += this.w.banditWeight * this.bandit.boost(doc.sourceType);
        // Doc-reuse penalty, capped so a rich source keeps contributing instead
        // of decaying to irrelevance after a few excerpts.
        const reuse =
          this.w.docReuseCap > 0
            ? Math.min(this.docCounts.get(passage.docId) ?? 0, this.w.docReuseCap)
            : this.docCounts.get(passage.docId) ?? 0;
        score -= this.w.docReusePenalty * reuse;
        if (
          pass === 1 &&
          doc.sourceType === this.lastType &&
          this.typeStreak >= this.w.maxTypeStreak &&
          !inOrder
        )
          score -= 0.5;

        if (!best || score > best.score) best = { passage, doc, score };
      }
      if (best) return this.emitPassage(best.passage, best.doc, target);
    }
    return null;
  }

  private emitPassage(
    passage: Passage,
    doc: SourceDoc,
    target: number,
    continues = false,
    contextRun = false,
  ): PassageCard {
    const concepts = this.conceptsOf(passage);
    const fresh = concepts.filter((c) => (this.exposure.get(c.id) ?? 0) === 0);

    // Threads back into the seen weave.
    const threads: Thread[] = [];
    for (const conn of this.corpus.connections.get(passage.id) ?? []) {
      const otherId = conn.a === passage.id ? conn.b : conn.a;
      const ref = this.emitted.get(otherId);
      if (!ref) continue;
      const other = this.corpus.passages.find((p) => p.id === otherId)!;
      const otherDoc = this.corpus.docs.get(other.docId)!;
      const viaConcepts = conn.via.map((id) => this.conceptById(id)).filter((c): c is Concept => !!c);
      threads.push({
        toCardId: ref.cardId,
        toCardIndex: ref.cardIndex,
        kind: threadKind(passage, doc, viaConcepts),
        via: conn.via,
        viaLabels: viaConcepts.map((c) => c.label),
        sourceTitle: otherDoc.title,
      });
      if (threads.length >= 3) break;
    }

    // When the ladder steps up a rung, say so -- progress should be felt.
    const targetRung = depthRung(target);
    let reason = continues
      ? `Staying with ${doc.title} — the thread runs straight on from the last card.`
      : contextRun
        ? `Setting the scene — ${doc.branch?.why ?? `the lead-up “${doc.branch?.concept ?? doc.title}” the idea sits downstream of`}`
        : this.reasonFor(passage, doc, threads, fresh);
    // The first trunk card after the context run bridges from the lead-up.
    if (!contextRun && this.handoffPending) {
      reason = `From the lead-up into the idea itself — ${reason}`;
      this.handoffPending = false;
    }
    if (targetRung > this.lastRung) {
      reason = `You've worked the ${DEPTH_LABEL[this.lastRung].toLowerCase()} material — stepping up to ${DEPTH_LABEL[targetRung].toLowerCase()}. ${reason}`;
      this.lastRung = targetRung;
    }

    // Advance loom state (the engine's advanceContext).
    const { id, index } = this.nextId();
    this.emitted.set(passage.id, { cardId: id, cardIndex: index });
    this.docCounts.set(passage.docId, (this.docCounts.get(passage.docId) ?? 0) + 1);
    if (doc.sourceType === 'video') this.videoCardsEmitted += 1;
    for (const c of concepts) {
      this.exposure.set(c.id, (this.exposure.get(c.id) ?? 0) + 1);
      if (c.definedByPassage === passage.id) this.definedSeen.add(c.id);
    }
    this.typeStreak = doc.sourceType === this.lastType ? this.typeStreak + 1 : 1;
    this.lastType = doc.sourceType;
    this.sameDocRun = passage.docId === this.lastDocId ? this.sameDocRun + 1 : 1;
    this.lastDocId = passage.docId;
    this.docLastIndex.set(passage.docId, passage.index);
    this.position += 1;
    this.sinceCheckpoint += 1;
    this.sinceCheck += 1;
    this.cardsSinceGate += 1;
    this.cardsSinceChain += 1;
    this.lastKind = 'passage';
    this.maybeStartChain(passage);

    return {
      kind: 'passage',
      id,
      index,
      passage,
      doc,
      concepts: concepts.map((c) => c.id),
      newConcepts: fresh.map((c) => c.id),
      threads,
      depth: depthRung(passage.depth ?? 1),
      reason,
    };
  }

  private reasonFor(passage: Passage, doc: SourceDoc, threads: Thread[], fresh: Concept[]): string {
    if (this.position === 0) return `A first foothold — ${doc.provider} grounding the topic in its own words.`;
    // The first card from a branch doc announces WHY the study map reached
    // for it -- the connection back to the main idea, in plain words.
    if (doc.branch && (this.docCounts.get(passage.docId) ?? 0) === 0) {
      return `Branching out (${doc.branch.kind}) — ${doc.branch.why}`;
    }
    const defined = this.conceptsOf(passage).find(
      (c) => c.definedByPassage === passage.id && (this.exposure.get(c.id) ?? 0) >= 2,
    );
    if (defined) {
      return `“${defined.label}” keeps recurring — this passage is where a source finally pins it down.`;
    }
    const top = threads[0];
    if (top) {
      const via = top.viaLabels.slice(0, 2).join('” and “');
      switch (top.kind) {
        case 'contrasts':
          return `Pushes back on card ${top.toCardIndex}'s picture of “${via}”.`;
        case 'questions':
          return `A discussion thread poking at “${via}” from card ${top.toCardIndex}.`;
        case 'applies':
          return `Puts “${via}” from card ${top.toCardIndex} to work in practice.`;
        case 'defines':
          return `Grounds “${via}”, which card ${top.toCardIndex} leaned on.`;
        default: {
          const freshNote = fresh.length > 0 ? `, opening “${fresh[0].label}”` : '';
          return `Builds on “${via}” from card ${top.toCardIndex}${freshNote}.`;
        }
      }
    }
    if (fresh.length > 0) {
      return `Opens a new thread: “${fresh
        .slice(0, 2)
        .map((c) => c.label)
        .join('”, “')}”.`;
    }
    return `Another source's angle on the same ground.`;
  }
}
