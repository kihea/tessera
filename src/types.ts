// ---------------------------------------------------------------------------
// Tessera domain types.
//
// Philosophy (the product's whole point): the app NEVER synthesizes content.
// Every card is a verbatim excerpt from a real source, linked back to it.
// What the app adds is the WEAVE: connections between excerpts. A card's
// "learning objective" is not the isolated fact it carries but the threads it
// ties to the material around it -- the form lives IN the material and is
// constructed from it (Aristotle), not handed down finished from outside it
// (Plato). The questioning checkpoints, where the learner writes the
// connections themselves, are the Socratic part.
// ---------------------------------------------------------------------------

export type SourceType =
  | 'encyclopedia' // Wikipedia
  | 'textbook' // Wikibooks
  | 'paper' // Crossref scholarly abstracts (the authors' own words)
  | 'discussion' // Hacker News comments
  | 'book' // Open Library pointers + Internet Archive full texts
  | 'news' // Chronicling America historic newspapers (Library of Congress)
  | 'primary' // Wikisource original documents and texts
  | 'reference' // Wiktionary definitions
  | 'video'; // YouTube — transcript snippets, embedded at the timestamp (desktop only)

/**
 * How a study-map branch relates to the main idea -- the iceberg's axes:
 * the lead-up it sits downstream of (context), what the idea presupposes
 * (prerequisite), how it works (mechanism), what goes into it (component),
 * where it bites (application), where it came from (foundation), what is
 * contested (frontier), and what sits beside it (adjacent). The branch-out
 * reach weight (0..1) gates how many of these are in play for a session.
 */
export type BranchKind =
  | 'context'
  | 'prerequisite'
  | 'mechanism'
  | 'component'
  | 'application'
  | 'foundation'
  | 'frontier'
  | 'adjacent';

/** One thread of the study map: a neighboring concept worth real sources. */
export interface StudyBranch {
  kind: BranchKind;
  concept: string;
  /** Literal search phrase used against the real providers. */
  query: string;
  /** What this thread unlocks about the main idea (shown to the learner). */
  why: string;
}

/** The branch-out plan for a session: model-built when one is configured. */
export interface StudyMap {
  idea: string;
  branches: StudyBranch[];
  builtBy: 'model' | 'heuristic';
}

export interface SourceDoc {
  id: string;
  provider: string; // human label: "Wikipedia", "Crossref", ...
  sourceType: SourceType;
  title: string;
  url: string;
  author?: string;
  date?: string;
  license?: string; // attribution note, e.g. CC BY-SA for wiki content
  /** Set when this doc was gathered for a study-map branch, not the seed query. */
  branch?: { kind: BranchKind; concept: string; why: string };
}

/** A verbatim excerpt. Never paraphrased, never summarized. */
export interface Passage {
  id: string;
  docId: string;
  text: string;
  /** Section heading / anchor within the source, when known. */
  anchor?: string;
  /** Deep link to the excerpt's location when the source supports it. */
  anchorUrl?: string;
  index: number; // position within its document
  /** Mastery depth 0..3 this excerpt presupposes (see weave/depth.ts). */
  depth?: number;
  /**
   * Set for video excerpts: the official YouTube embed to render at this
   * transcript moment. The excerpt text stays a short verbatim snippet; the
   * player IS the source, shown at its timestamp.
   */
  embed?: { videoId: string; startSec: number; endSec?: number };
}

/**
 * Dimensional layer of a concept (the user's framework): 1 idea/existence ·
 * 2 attribute/gradience (the signed-intensity axis) · 3 form/boundary ·
 * 4 time/organization · 5 abstract concept/society. Classified semantically from
 * the concept's embedding (weave/dimensions.ts), never from its surface word.
 */
export type Dimension = 1 | 2 | 3 | 4 | 5;

/** A shared term that recurs across the corpus -- a node in the weave. */
export interface Concept {
  id: string; // normalized key
  label: string; // most common surface form
  df: number; // how many passages mention it
  weight: number; // idf-style importance
  passageIds: string[];
  /**
   * Whether this term is meaningful enough to anchor a reference card, a check,
   * or a weave checkpoint. Generic recurring words ("level", "low") may still
   * be concepts but are NOT important -- they never get defined or quizzed.
   */
  important?: boolean;
  /** Filled from Wiktionary only when no corpus passage defines the term. */
  definition?: { text: string; url: string; source: string };
  /** Passage that defines this term inside the corpus, if any. */
  definedByPassage?: string;
  /**
   * Form (entity/substance) vs attribute (quality). Set only when a corpus is
   * rehydrated from the knowledge graph (graphStore.subgraphToCorpus) so the
   * graph view can distinguish them; unset in live sessions, ignored by the loom.
   */
  kind?: 'form' | 'attribute';
  /** Dimensional layer (1-5), classified from the embedding; see weave/dimensions.ts. */
  dimension?: Dimension;
}

/**
 * A rendered equation lifted from a source's own markup (Wikipedia math
 * images: hotlinkable SVG + the LaTeX in its alt text). Topics like the
 * Fourier transform are not learnable from prose alone -- the formula IS part
 * of the source material, shown verbatim with its surrounding context.
 */
export interface Formula {
  id: string;
  latex: string; // the source's own TeX, from the image alt
  svgUrl: string; // wikimedia REST render of exactly that TeX
  caption?: string; // the source's name for it ("Fourier transform", from equation-box)
  section?: string; // heading the equation sits under
  context?: string; // the prose sentence(s) introducing it
  sourceTitle: string;
  url: string; // deep link to the section when known
  conceptIds: string[]; // recurring terms this formula grounds (filled during weaving)
}

export type ThreadKind = 'defines' | 'extends' | 'contrasts' | 'applies' | 'questions' | 'grounds';

/** A connection between two passages, carried by shared concepts. */
export interface Connection {
  a: string; // passage id
  b: string; // passage id
  via: string[]; // shared concept ids -- these ARE the learning objectives
  strength: number;
}

/** A thread shown on a card: how this excerpt ties to an earlier card. */
export interface Thread {
  toCardId: string;
  toCardIndex: number; // 1-based, as displayed
  kind: ThreadKind;
  via: string[]; // concept ids
  viaLabels: string[];
  sourceTitle: string;
}

export interface PassageCard {
  kind: 'passage';
  id: string;
  index: number; // 1-based feed position
  passage: Passage;
  doc: SourceDoc;
  concepts: string[]; // concept ids present
  newConcepts: string[]; // first-time concepts this card introduces
  threads: Thread[];
  depth: 0 | 1 | 2 | 3; // mastery rung this excerpt sits on
  reason: string; // why the loom chose it NOW (transparency, like engine reasons)
}

export interface DefinitionCard {
  kind: 'definition';
  id: string;
  index: number;
  conceptId: string;
  label: string;
  definition: string;
  url: string;
  source: string;
  reason: string;
}

export interface CheckpointCard {
  kind: 'checkpoint';
  id: string;
  index: number;
  conceptA: string;
  conceptB: string;
  labelA: string;
  labelB: string;
  /** The Socratic question -- open, pointed, opinion-forming (not "how do A and B relate"). */
  prompt: string;
  /** Representative excerpts already seen, quoted in the notes template. */
  quoteA: { text: string; title: string; url: string };
  quoteB: { text: string; title: string; url: string };
  cardRefA: number;
  cardRefB: number;
  reason: string;
}

export type CheckFormat = 'cloze' | 'mcq';

/**
 * A small check for understanding drawn from real passage content -- a cloze
 * blank or a multiple-choice recall of one thread. It GATES the feed: the next
 * cards stay locked until it is answered, and its correctness feeds the
 * retention signal for its source type (so preferences track what is actually
 * remembered, per material type).
 */
export interface CheckCard {
  kind: 'check';
  id: string;
  index: number;
  format: CheckFormat;
  instruction: string; // short framing line
  blanked: string; // the source sentence with the key term replaced by a blank
  answer: string; // the concept label that fills the blank (display form)
  accept: string[]; // lowercased acceptable inputs for a cloze
  options?: string[]; // labels for a multiple-choice check (includes the answer)
  conceptId: string;
  conceptLabel: string;
  sourceType: SourceType; // material this was drawn from -- for retention attribution
  cardRef: number; // the card it was drawn from
  sourceTitle: string;
  reason: string;
}

/** A formula shown when the term it grounds has gone hot in the weave. */
export interface FormulaCard {
  kind: 'formula';
  id: string;
  index: number;
  conceptId: string;
  label: string; // concept label the formula grounds
  latex: string;
  svgUrl: string;
  caption?: string;
  section?: string;
  context?: string; // the source's own prose introducing the equation
  sourceTitle: string;
  url: string;
  reason: string;
}

/**
 * A flashcard for active recall: the front is a concept cue; the back is its
 * source-grounded answer (the sentence that defines it, or its reference
 * definition), revealed on flip. Self-graded and NON-gate -- it never locks the
 * feed; it just interleaves spaced recall alongside the reading.
 */
export interface FlashcardCard {
  kind: 'flashcard';
  id: string;
  index: number;
  conceptId: string;
  label: string; // the cue (the concept)
  front: string; // the prompt shown first
  back: string; // the grounded answer, revealed on flip
  source: { title: string; url: string };
  reason: string;
}

export interface EndCard {
  kind: 'end';
  id: string;
  index: number;
}

export type FeedCard =
  | PassageCard
  | DefinitionCard
  | CheckpointCard
  | CheckCard
  | FormulaCard
  | FlashcardCard
  | EndCard;

/** Cards that lock forward progress until the learner completes them. */
export type GateCard = CheckpointCard | CheckCard;

export function isGate(card: FeedCard): card is GateCard {
  return card.kind === 'checkpoint' || card.kind === 'check';
}

/** Per-card engagement signals. Active processing >> passive dwell. */
export interface CardSignals {
  dwellMs: number;
  clipped: boolean;
  openedSource: boolean;
  checkpointInserted: boolean;
}

export interface ProviderProgress {
  name: string;
  status: 'pending' | 'ok' | 'fail';
  passages: number;
}

export interface Corpus {
  docs: Map<string, SourceDoc>;
  passages: Passage[];
  concepts: Concept[];
  /** passage id -> its strongest connections */
  connections: Map<string, Connection[]>;
  /** equations harvested from the sources' own markup */
  formulas: Formula[];
  /** the branch-out plan this corpus was gathered under, if any */
  studyMap?: StudyMap;
}

// -- learner preferences (onboarding) ---------------------------------------

/** -1 = surface less, 0 = neutral, +1 = prefer. */
export type Affinity = -1 | 0 | 1;

/** How a session should open: ground-up, into the debate, or balanced. */
export type Opening = 'ground' | 'debate' | 'balanced';

export interface LearnerPrefs {
  sourceAffinity: Record<SourceType, Affinity>;
  opening: Opening;
  /** Weave-checkpoint cadence in cards. */
  checkpointEvery: number;
}
