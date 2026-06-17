// Auto-tuner for the WeaveWeights. Because reLoom replays the feed over an
// already-built corpus with zero network/model cost, we can evaluate hundreds
// of weight configurations in a blink and SEARCH for the best one.
//
// Method: separable CMA-ES (Ros & Hansen 2008) -- a derivative-free evolution
// strategy, the frontier standard for black-box continuous optimization. The
// "separable" variant adapts a DIAGONAL covariance (a per-coordinate step size)
// instead of a full matrix, so there is no eigendecomposition and it scales to
// ~20 weights cheaply. We keep the canonical mean recombination + cumulative
// step-size adaptation (CSA) and the rank-mu diagonal update; weights are
// optimized in a normalized [0,1] box, so isotropic-ish sampling is well-posed.
//
// The objective is a higher-level FEED-QUALITY score (coverage, connection,
// variety, cohesion, anti-degeneracy, novelty pacing, ladder climb, gate
// spacing, context on-ramp) -- deliberately distinct from the loom's own
// scoring, so we are optimizing the engine toward product goals, not toward
// itself. It optimizes the CURRENT session's corpus (per-topic), so treat it as
// "tune for this kind of material," not a universal setting.

import type { Corpus, FeedCard } from '../types';
import { Loom } from './loom';
import type { LoomOptions } from './loom';
import { TypeBandit } from './bandit';
import type { WeaveWeights } from './weights';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

function entropy(counts: number[], total: number): number {
  let e = 0;
  for (const c of counts) if (c > 0) e -= (c / total) * Math.log2(c / total);
  return e;
}

// ---- the tunable surface (normalized [0,1] each) ---------------------------
interface Knob {
  key: keyof WeaveWeights;
  min: number;
  max: number;
  int?: boolean;
}
const TUNABLE: Knob[] = [
  { key: 'maxPerDoc', min: 3, max: 16, int: true },
  { key: 'maxSameDocRun', min: 1, max: 6, int: true },
  { key: 'contextRunLen', min: 0, max: 6, int: true },
  { key: 'maxVideoCards', min: 0, max: 6, int: true },
  { key: 'continueInOrderBonus', min: 0, max: 2.5 },
  { key: 'maxTypeStreak', min: 1, max: 5, int: true },
  { key: 'docReusePenalty', min: 0, max: 0.8 },
  { key: 'docReuseCap', min: 0, max: 8, int: true },
  { key: 'connectionWeight', min: 0.2, max: 3.5 },
  { key: 'masteryFitBase', min: 0, max: 1.5 },
  { key: 'masteryAbovePenalty', min: 0, max: 2.5 },
  { key: 'masteryBelowPenalty', min: 0, max: 1.5 },
  { key: 'noveltyFewBonus', min: 0, max: 1.5 },
  { key: 'noveltyNonePenalty', min: 0, max: 1.5 },
  { key: 'noveltyManyPenalty', min: 0, max: 1 },
  { key: 'dueReviewBonus', min: 0, max: 1.6 },
  { key: 'banditWeight', min: 0, max: 1.5 },
  { key: 'frontierPush', min: 0, max: 1.5 },
  { key: 'chainEveryCards', min: 4, max: 30, int: true },
  { key: 'chainLen', min: 1, max: 6, int: true },
];

function toWeights(x: number[], base: WeaveWeights): WeaveWeights {
  const w: WeaveWeights = { ...base };
  TUNABLE.forEach((k, i) => {
    let v = k.min + clamp01(x[i]) * (k.max - k.min);
    if (k.int) v = Math.round(v);
    (w as unknown as Record<string, number>)[k.key as string] = v;
  });
  return w;
}
function fromWeights(w: WeaveWeights): number[] {
  return TUNABLE.map((k) => clamp01((Number(w[k.key]) - k.min) / (k.max - k.min)));
}

// ---- feed quality objective -------------------------------------------------
function isPassage(c: FeedCard): c is Extract<FeedCard, { kind: 'passage' }> {
  return c.kind === 'passage';
}

export interface FeedScore {
  score: number;
  parts: Record<string, number>;
}

/** Generate the full planned feed for a weight config (no gates block here). */
export function planFeed(corpus: Corpus, opts: LoomOptions, weights: WeaveWeights, cap = 64): FeedCard[] {
  const loom = new Loom(corpus, new TypeBandit(null), opts, weights);
  const cards: FeedCard[] = [];
  for (let i = 0; i < cap; i++) {
    const c = loom.next();
    if (!c || c.kind === 'end') break;
    cards.push(c);
  }
  return cards;
}

export function scoreFeed(corpus: Corpus, cards: FeedCard[]): FeedScore {
  const passages = cards.filter(isPassage);
  const P = passages.length;
  if (P < 3) return { score: 0, parts: {} };

  const important = new Set(corpus.concepts.filter((c) => c.important).map((c) => c.id));
  const IC = Math.max(1, important.size);

  // coverage: important concepts actually surfaced
  const covered = new Set<string>();
  for (const p of passages) for (const id of p.concepts) if (important.has(id)) covered.add(id);
  const coverage = covered.size / IC;

  // connection: cards (past the opening) that thread back into the weave
  let withThreads = 0;
  passages.forEach((p, i) => {
    if (i >= 2 && p.threads.length > 0) withThreads += 1;
  });
  const connection = withThreads / Math.max(1, P - 2);

  // variety: source-type entropy, normalized by what the corpus could offer
  const typeCounts = new Map<string, number>();
  for (const p of passages) typeCounts.set(p.doc.sourceType, (typeCounts.get(p.doc.sourceType) ?? 0) + 1);
  const typesAvail = new Set([...corpus.docs.values()].map((d) => d.sourceType)).size;
  const variety = entropy([...typeCounts.values()], P) / Math.max(0.001, Math.log2(Math.max(2, typesAvail)));

  // novelty pacing: open 1-3 new threads, never 0 and never a flood
  let paced = 0;
  for (const p of passages) if (p.newConcepts.length >= 1 && p.newConcepts.length <= 3) paced += 1;
  const novelty = paced / P;

  // cohesion: same-doc runs, rewarded in a sweet spot around ~2.5
  const runs: number[] = [];
  let run = 1;
  for (let i = 1; i < passages.length; i++) {
    if (passages[i].doc.id === passages[i - 1].doc.id) run += 1;
    else {
      runs.push(run);
      run = 1;
    }
  }
  runs.push(run);
  const avgRun = avg(runs);
  const cohesion = Math.exp(-((avgRun - 2.5) ** 2) / (2 * 1.2 ** 2));

  // doc balance: anti-degeneracy -- no single source should dominate the feed
  const docCounts = new Map<string, number>();
  for (const p of passages) docCounts.set(p.doc.id, (docCounts.get(p.doc.id) ?? 0) + 1);
  const maxShare = Math.max(...docCounts.values()) / P;
  const docBalance = clamp01(1 - Math.max(0, maxShare - 0.35) / 0.65);

  // ladder: depth should climb across the session
  const half = Math.floor(P / 2);
  const ladder = clamp01(
    0.5 + (avg(passages.slice(half).map((p) => p.depth)) - avg(passages.slice(0, half).map((p) => p.depth))) / 2,
  );

  // gate spacing: present and spaced (~1 gate per 5-6 cards)
  const gates = cards.filter((c) => c.kind === 'checkpoint' || c.kind === 'check').length;
  const gateRate = gates / cards.length;
  const gateSpacing = Math.exp(-((gateRate - 0.18) ** 2) / (2 * 0.1 ** 2));

  const terms: [string, number, number][] = [
    ['coverage', coverage, 0.18],
    ['connection', connection, 0.18],
    ['variety', variety, 0.12],
    ['novelty', novelty, 0.12],
    ['cohesion', cohesion, 0.12],
    ['docBalance', docBalance, 0.12],
    ['ladder', ladder, 0.08],
    ['gateSpacing', gateSpacing, 0.05],
  ];

  // context on-ramp: only graded when the corpus actually has lead-up sources
  const ctxDocs = new Set(
    [...corpus.docs.values()].filter((d) => d.branch?.kind === 'context').map((d) => d.id),
  );
  if (ctxDocs.size > 0) {
    const lead = passages.slice(0, 3);
    const ctxLead = lead.filter((p) => ctxDocs.has(p.doc.id)).length;
    terms.push(['context', clamp01(ctxLead / Math.min(3, lead.length)), 0.04]);
  }

  const wsum = terms.reduce((s, [, , w]) => s + w, 0);
  const score = terms.reduce((s, [, v, w]) => s + w * clamp01(v), 0) / wsum;
  const parts: Record<string, number> = {};
  for (const [name, v] of terms) parts[name] = Math.round(clamp01(v) * 100) / 100;
  return { score, parts };
}

// ---- separable CMA-ES -------------------------------------------------------
function gaussian(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface TuneResult {
  weights: WeaveWeights;
  score: number;
  baseScore: number;
  parts: Record<string, number>;
  evals: number;
  gens: number;
}

export async function autoTune(
  corpus: Corpus,
  opts: LoomOptions,
  base: WeaveWeights,
  onProgress?: (gen: number, best: number) => void,
  maxGens = 40,
): Promise<TuneResult> {
  const D = TUNABLE.length;
  const f = (x: number[]) => scoreFeed(corpus, planFeed(corpus, opts, toWeights(x, base))).score;

  // population + weighted recombination
  const lambda = 4 + Math.floor(3 * Math.log(D));
  const mu = Math.floor(lambda / 2);
  const wRaw = Array.from({ length: mu }, (_, i) => Math.log(mu + 0.5) - Math.log(i + 1));
  const wSum = wRaw.reduce((s, x) => s + x, 0);
  const recw = wRaw.map((x) => x / wSum);
  const muEff = 1 / recw.reduce((s, x) => s + x * x, 0);

  // step-size + covariance learning rates (separable speed-up on rank-mu)
  const cSigma = (muEff + 2) / (D + muEff + 5);
  const dSigma = 1 + 2 * Math.max(0, Math.sqrt((muEff - 1) / (D + 1)) - 1) + cSigma;
  const cC = (4 + muEff / D) / (D + 4 + (2 * muEff) / D);
  const sep = (D + 2) / 3; // separable speed-up on the covariance learning rates
  const cMu = Math.min(1, ((2 * (muEff - 2 + 1 / muEff)) / ((D + 2) ** 2 + muEff)) * sep);
  const c1 = Math.min(1 - cMu, (2 / ((D + 1.3) ** 2 + muEff)) * sep);
  const eNorm = Math.sqrt(D) * (1 - 1 / (4 * D) + 1 / (21 * D * D));

  let m = fromWeights(base);
  let sigma = 0.3;
  const dVar = new Array(D).fill(1); // per-coordinate variance (diagonal C)
  let pSigma = new Array(D).fill(0);
  let pC = new Array(D).fill(0); // anisotropic evolution path (rank-1)

  let bestX = m.slice();
  let bestF = f(m);
  let evals = 1;

  for (let gen = 0; gen < maxGens; gen++) {
    const pop: { y: number[]; f: number }[] = [];
    for (let k = 0; k < lambda; k++) {
      const y = Array.from({ length: D }, (_, i) => Math.sqrt(dVar[i]) * gaussian());
      const x = m.map((mi, i) => clamp01(mi + sigma * y[i]));
      const fx = f(x);
      evals += 1;
      pop.push({ y, f: fx });
      if (fx > bestF) {
        bestF = fx;
        bestX = x.slice();
      }
    }
    pop.sort((a, b) => b.f - a.f); // maximize

    // recombine the steps of the mu best
    const yw = new Array(D).fill(0);
    for (let i = 0; i < mu; i++) for (let j = 0; j < D; j++) yw[j] += recw[i] * pop[i].y[j];
    m = m.map((mi, j) => clamp01(mi + sigma * yw[j]));

    // CSA: C^{-1/2} yw = yw / sqrt(dVar) for a diagonal C
    const csa = Math.sqrt(cSigma * (2 - cSigma) * muEff);
    pSigma = pSigma.map((ps, j) => (1 - cSigma) * ps + csa * (yw[j] / Math.sqrt(dVar[j])));
    const psNorm = Math.sqrt(pSigma.reduce((s, x) => s + x * x, 0));
    sigma = Math.max(2e-3, Math.min(0.5, sigma * Math.exp((cSigma / dSigma) * (psNorm / eNorm - 1))));

    // rank-1 evolution path (the main CMA accelerator)
    const hSigma =
      psNorm / Math.sqrt(1 - Math.pow(1 - cSigma, 2 * (gen + 1))) / eNorm < 1.4 + 2 / (D + 1) ? 1 : 0;
    pC = pC.map((pc, j) => (1 - cC) * pc + hSigma * Math.sqrt(cC * (2 - cC) * muEff) * yw[j]);

    // diagonal covariance update: rank-1 (path) + rank-mu (this generation)
    for (let j = 0; j < D; j++) {
      let rankMu = 0;
      for (let i = 0; i < mu; i++) rankMu += recw[i] * pop[i].y[j] * pop[i].y[j];
      const rank1 = pC[j] * pC[j] + (1 - hSigma) * cC * (2 - cC) * dVar[j];
      dVar[j] = Math.max(1e-6, Math.min(4, (1 - c1 - cMu) * dVar[j] + c1 * rank1 + cMu * rankMu));
    }

    onProgress?.(gen + 1, bestF);
    await new Promise((r) => setTimeout(r, 0)); // keep the UI responsive
  }

  const weights = toWeights(bestX, base);
  const sc = scoreFeed(corpus, planFeed(corpus, opts, weights));
  const baseScore = scoreFeed(corpus, planFeed(corpus, opts, base)).score;
  return { weights, score: sc.score, baseScore, parts: sc.parts, evals, gens: maxGens };
}
