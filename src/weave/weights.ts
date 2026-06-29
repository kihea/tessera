// Every Loom scoring/structural knob in one place, so the feed can be tuned
// (and hot-replayed by the dev panel) WITHOUT touching logic. These all apply
// at card-emit time over an already-built Corpus, so changing them needs only a
// Loom rebuild + replay -- never re-research or the model (see session.reLoom).
//
// Defaults are tuned for SOURCE COHESION: a source should read as a coherent
// stretch rather than scattered splices, while the cross-source weave survives.

export interface WeaveWeights {
  // -- structural caps --------------------------------------------------------
  /** Max cards drawn from one source doc per session. */
  maxPerDoc: number;
  /** No more than this many of the same SOURCE TYPE in a row (cross-doc variety). */
  maxTypeStreak: number;
  /** Allow up to this many consecutive IN-ORDER excerpts from ONE doc — read a source as a stretch. */
  maxSameDocRun: number;
  /** Length of the opening lead-up "context" run before the trunk (0 disables). */
  contextRunLen: number;
  /** Times a concept must be surfaced before it counts as "hot" (grounding / quiz / formula). */
  hotExposure: number;
  /** Formula cards per session. */
  maxFormulas: number;
  /** Video embed cards (curated + live YouTube) surfaced per session. */
  maxVideoCards: number;
  /** Cards between active-recall flashcards (0 disables). */
  flashcardEvery: number;

  // -- doc reuse --------------------------------------------------------------
  /** Per-use score penalty for returning to a doc. */
  docReusePenalty: number;
  /** Cap the doc-use count inside that penalty so a rich source never decays to irrelevance (0 = uncapped). */
  docReuseCap: number;

  // -- cohesion bonuses -------------------------------------------------------
  /** Bonus when a candidate is the NEXT paragraph (document order) of the last doc shown. */
  continueInOrderBonus: number;

  // -- monumental "continues" chain -------------------------------------------
  /** Master switch for the occasional deep-dive run on a spine concept. */
  chainEnabled: boolean;
  /** A "spine" concept is among the top-N by df... */
  chainSpineTopN: number;
  /** ...and spans at least this many distinct docs (central to the main idea, not one source's vocabulary). */
  chainSpineMinDocs: number;
  /** Total length of the contiguous run when a chain fires (including the trigger card). */
  chainLen: number;
  /** Minimum cards between chains. */
  chainEveryCards: number;
  /** Don't start a chain before this many passages have been emitted (let the trunk form). */
  chainMinPosition: number;

  // -- passage scoring terms --------------------------------------------------
  /** Connection to the seen weave, per familiar concept: weight × (min(exp,3)/3). */
  connectionWeight: number;
  /** Flat mastery-fit credit before the depth-gap penalty. */
  masteryFitBase: number;
  /** Penalty per rung the passage sits ABOVE the learner's stage (asymmetric, the larger one). */
  masteryAbovePenalty: number;
  /** Penalty per rung the passage sits BELOW the stage. */
  masteryBelowPenalty: number;
  /** Bonus for deep material once the learner is at the frontier. */
  frontierPush: number;
  /** Penalty for a passage that opens no new threads. */
  noveltyNonePenalty: number;
  /** Bonus for a passage opening 1–3 new threads. */
  noveltyFewBonus: number;
  /** Penalty per new thread beyond 3 (a flood). */
  noveltyManyPenalty: number;
  /** Bonus for grounding a hot, still-undefined term ("due review"). */
  dueReviewBonus: number;
  /** Weight on the source-type bandit's nudge. */
  banditWeight: number;
  /** Iceberg ordering (opt-in): pull toward the descending dimensional target so the
   *  feed opens on the high-dimensional overview then dials into detail. */
  icebergWeight: number;

  // -- checkpoint scoring -----------------------------------------------------
  /** Weight on co-occurrence (real connection) when choosing a weave checkpoint pair. */
  checkpointTogetherWeight: number;
  /** Weight on recency of the two threads. */
  checkpointRecencyWeight: number;
  /** Penalty for re-weaving threads already used in earlier checkpoints. */
  checkpointReusePenalty: number;
}

export const DEFAULT_WEIGHTS: WeaveWeights = {
  // structural caps — cohesion-tuned
  maxPerDoc: 8, // was 5: let books / encyclopedia articles speak at length
  maxTypeStreak: 2,
  maxSameDocRun: 3, // new
  contextRunLen: 3, // new: lead-up on-ramp at the Balanced reach tier and up
  hotExposure: 3,
  maxFormulas: 5,
  maxVideoCards: 2, // new: how many video embeds the feed surfaces (auto-tunable)
  flashcardEvery: 7, // a recall flashcard roughly every 7 cards once terms warm up

  // doc reuse
  docReusePenalty: 0.2,
  docReuseCap: 3, // new: stop the penalty growing past 3 uses

  // cohesion bonuses
  continueInOrderBonus: 0.7, // new

  // monumental continues-chain
  chainEnabled: true,
  chainSpineTopN: 6,
  chainSpineMinDocs: 3,
  chainLen: 3,
  chainEveryCards: 10,
  chainMinPosition: 4,

  // passage scoring (current production values, now tunable)
  connectionWeight: 1.4,
  masteryFitBase: 0.55,
  masteryAbovePenalty: 1.1,
  masteryBelowPenalty: 0.35,
  frontierPush: 0.6,
  noveltyNonePenalty: 0.4,
  noveltyFewBonus: 0.5,
  noveltyManyPenalty: 0.3,
  dueReviewBonus: 0.85,
  banditWeight: 0.4,
  icebergWeight: 0.5,

  // checkpoint scoring
  checkpointTogetherWeight: 3,
  checkpointRecencyWeight: 0.1,
  checkpointReusePenalty: 2.2,
};

// -- dev-panel persistence ----------------------------------------------------
// Tuned weights are saved here and drive every session (loaded in useSession),
// so "tune it once" becomes the app's behavior. Reset clears the override.

const KEY = 'tessera:weave-weights';

export function loadWeights(): WeaveWeights {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_WEIGHTS };
    // Merge over defaults so a stored blob missing newer keys stays valid.
    return { ...DEFAULT_WEIGHTS, ...(JSON.parse(raw) as Partial<WeaveWeights>) };
  } catch {
    return { ...DEFAULT_WEIGHTS };
  }
}

export function saveWeights(w: WeaveWeights): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(w));
  } catch {
    // storage full / privacy mode: tuning still lives in memory this session
  }
}

export function resetWeights(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
