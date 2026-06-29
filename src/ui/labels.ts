import type { SourceType } from '../types';

export const TYPE_LABEL: Record<SourceType, string> = {
  encyclopedia: 'Encyclopedia',
  textbook: 'Textbook',
  paper: 'Paper',
  discussion: 'Discussion',
  book: 'Book',
  news: 'Newspaper',
  primary: 'Primary source',
  reference: 'Reference',
  video: 'Video',
};

export const TYPE_DESC: Record<SourceType, string> = {
  encyclopedia: 'structured overviews that ground a topic',
  textbook: 'step-by-step teaching material',
  paper: 'researchers in their own words',
  discussion: 'practitioners arguing and pushing back',
  book: 'long-form treatments, with their actual text',
  news: 'historic reporting from the period itself',
  primary: 'original documents, unmediated',
  reference: 'precise pin-downs of recurring terms',
  video: 'lectures and talks, at the relevant moment',
};

// Reach is the two-sides-of-mastery spectrum the learner sets, read by the
// engine as a continuous 0..1 radius (prompts.ts: KIND_BUDGET gates which
// branch kinds are in play, branchBudget how many; expand.ts ties crawl depth
// to it). The two ends are the two ways to master something: DEEP DIVE (low)
// drills the core -- what the idea is built from, read in depth, the source
// allowed to fully talk; FRONTIER (high) opens the most knowledgeable edge --
// every angle, debate, and neighboring field, an endless widening feed.
// BALANCED is the 50/50 between them.

export interface ReachLevel {
  key: string;
  label: string;
  /** The 0..1 radius this stop sets. */
  radius: number;
  /** One line, addressed to the learner, on what this reach gathers. */
  blurb: string;
}

export const REACH_LEVELS: ReachLevel[] = [
  {
    key: 'deep',
    label: 'Deep dive',
    radius: 0.12,
    blurb: 'Drill the core — what the idea is built from, read in depth.',
  },
  {
    key: 'inward',
    label: 'Leaning deep',
    radius: 0.32,
    blurb: 'Mostly inward — its mechanisms and first principles.',
  },
  {
    key: 'balanced',
    label: 'Balanced',
    radius: 0.5,
    blurb: 'Half its inner workings, half its wider world — 50/50.',
  },
  {
    key: 'outward',
    label: 'Leaning frontier',
    radius: 0.72,
    blurb: 'Mostly outward — where it is applied and what is argued.',
  },
  {
    key: 'frontier',
    label: 'Frontier',
    radius: 0.95,
    blurb: 'The open edge — every angle and neighboring field, an endless feed.',
  },
];

/** Snap a stored radius to the nearest named stop, for display + selection. */
export function nearestReach(radius: number): ReachLevel {
  return REACH_LEVELS.reduce((best, lvl) =>
    Math.abs(lvl.radius - radius) < Math.abs(best.radius - radius) ? lvl : best,
  );
}
