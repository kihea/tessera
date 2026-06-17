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

// Branch-out reach as five named stops along the continuous 0..1 radius the
// engine actually reads. The radius is what the study map and loom consume
// (prompts.ts: KIND_BUDGET gates which branch kinds are in play, branchBudget
// gates how many) -- these stops are just how a learner picks it. Ordered
// narrow -> wide: Focused stays on the spine of the idea; Far-reaching opens
// the whole iceberg, out to the frontier and neighboring fields.

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
    key: 'focused',
    label: 'Focused',
    radius: 0.15,
    blurb: 'The spine only — what the idea assumes and how it works.',
  },
  {
    key: 'depth',
    label: 'Depth',
    radius: 0.35,
    blurb: 'Dig inward — the parts the idea is built from.',
  },
  {
    key: 'balanced',
    label: 'Balanced',
    radius: 0.55,
    blurb: 'Where it bites in practice, and where it came from.',
  },
  {
    key: 'exploratory',
    label: 'Exploratory',
    radius: 0.8,
    blurb: 'Out to the live debates experts still argue.',
  },
  {
    key: 'far',
    label: 'Far-reaching',
    radius: 0.95,
    blurb: 'The whole field — the frontier and what sits beside it.',
  },
];

/** Snap a stored radius to the nearest named stop, for display + selection. */
export function nearestReach(radius: number): ReachLevel {
  return REACH_LEVELS.reduce((best, lvl) =>
    Math.abs(lvl.radius - radius) < Math.abs(best.radius - radius) ? lvl : best,
  );
}
