// Source-type bandit, adapted from TestApp's engine Stage B (UCB + EWMA).
// Arms are SOURCE TYPES (encyclopedia / textbook / paper / discussion / book)
// instead of techniques, and -- exactly as in the engine -- the reward is a
// LEARNING signal, never raw dwell: clipping an excerpt into notes, opening
// the original source, completing a weave checkpoint. Dwell contributes only
// a small, hard-capped share, so doomscrolling cannot teach the bandit
// anything. The bandit only nudges feed ordering; it can never override the
// weave (connection/novelty) constraints, just as the engine's bandit could
// never cross pedagogical slots.

import type { Affinity, CardSignals, SourceType } from '../types';

const UCB_C = 0.5;
const EWMA_ALPHA = 0.3;
// Retention (did a check pass?) is the signal the learner actually asked to be
// judged on, so it moves an arm faster than passive engagement does.
const RETENTION_ALPHA = 0.55;

export interface ArmState {
  pulls: number;
  value: number; // recency-weighted mean reward
}

export type BanditState = Record<string, ArmState>;

export class TypeBandit {
  private arms: Map<SourceType, ArmState>;

  constructor(saved?: BanditState | null) {
    this.arms = new Map();
    if (saved) {
      for (const [k, v] of Object.entries(saved)) this.arms.set(k as SourceType, { ...v });
    }
  }

  /**
   * Warm-start from the onboarding questionnaire (the engine's
   * seedPreferences). Deliberately a PRIOR, not a verdict: each seeded arm
   * gets only 2 phantom pulls, so what the learner actually DOES -- clips,
   * source-opens, completed weaves -- quickly outweighs what they predicted
   * about themselves. People often misjudge how they retain; the seed only
   * shapes the first session, the evidence shapes the rest.
   */
  seed(affinity: Record<SourceType, Affinity>): void {
    for (const [type, a] of Object.entries(affinity) as [SourceType, Affinity][]) {
      if (a === 0) continue;
      this.arms.set(type, { pulls: 2, value: a > 0 ? 0.65 : 0.2 });
    }
  }

  /** Optimism-under-uncertainty boost used as ONE term in loom scoring. */
  boost(type: SourceType): number {
    const arm = this.arms.get(type);
    const totalPulls = [...this.arms.values()].reduce((s, a) => s + a.pulls, 0) + 1;
    if (!arm || arm.pulls === 0) return 0.8; // never tried: worth sampling
    return arm.value + UCB_C * Math.sqrt(Math.log(totalPulls) / arm.pulls);
  }

  reward(type: SourceType, signals: CardSignals): void {
    const r = Math.min(
      1,
      0.25 * Math.min(signals.dwellMs / 12000, 1) + // capped: attention floor, not the objective
        (signals.clipped ? 0.55 : 0) + // active selection into one's own notes
        (signals.openedSource ? 0.3 : 0) + // went to the original
        (signals.checkpointInserted ? 0.7 : 0), // attempted the synthesis themselves
    );
    this.update(type, r);
  }

  /**
   * The strongest signal of all: did the learner actually RETAIN material from
   * this source type? Answered by a check for understanding drawn from it. This
   * is what lets preferences track retention per material type independently --
   * someone may breeze through discussion threads but only remember textbooks.
   */
  rewardRetention(type: SourceType, correct: boolean): void {
    this.update(type, correct ? 0.95 : 0.1, RETENTION_ALPHA);
  }

  private update(type: SourceType, r: number, alpha = EWMA_ALPHA): void {
    const arm = this.arms.get(type) ?? { pulls: 0, value: 0 };
    arm.pulls += 1;
    arm.value = arm.value + alpha * (r - arm.value);
    this.arms.set(type, arm);
  }

  toJSON(): BanditState {
    const out: BanditState = {};
    for (const [k, v] of this.arms) out[k] = { ...v };
    return out;
  }
}
