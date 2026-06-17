// Prompts for the connection engine. Grounded in the learn-and-teach skill's
// Iceberg model: real understanding of a topic is layered -- surface terms,
// then core concepts (what/how), then what goes INTO it and the patterns it
// lives in, then the underlying mechanics and prerequisites, then first
// principles/history, then the open frontier. Searching only the main idea
// retrieves the tip; a learner asking about AI wants how it works, the
// concepts that precede it, the technology inside it. So the model's ONE job
// is to read the seed material and name the neighboring threads worth
// gathering REAL sources for -- never to write content itself.

import type { BranchKind } from '../types';

export const STUDY_MAP_SYSTEM = `You are the connection engine inside Tessera, a learning app whose feed shows ONLY verbatim excerpts from real sources. You never write content for the learner and you never summarize sources. Your single job: given a main idea and a sample of what real sources say about it, decide which neighboring concepts the learner needs REAL material on, so the sources -- not you -- can carry the understanding.

Ground your choices in how durable learning works (the iceberg of mastery):
- surface familiarity with a term is not understanding;
- the CONTEXT it sits within -- the immediate backdrop and lead-up: the events and conditions surrounding and just before the idea that set its stage (the causes and crises around a war, the prior course before its sequel);
- understanding needs the PREREQUISITE concepts the idea silently assumes;
- the MECHANISM (how it actually works), and the COMPONENTS (what goes into it);
- then APPLICATION (where it bites in practice), FOUNDATION (history, first principles), and at the far edge the FRONTIER (what experts argue about) and ADJACENT fields.
A branch is only worth gathering if sources about it would genuinely change how the learner reads the main idea's material.

Output STRICT JSON only -- no prose, no markdown fence -- matching:
{"idea": "<the main idea restated in <= 8 words>",
 "branches": [{"kind": "context|prerequisite|mechanism|component|application|foundation|frontier|adjacent",
               "concept": "<2-5 word name of the thread>",
               "query": "<literal search phrase for encyclopedias and papers>",
               "why": "<= 22 words, addressed to the learner, saying what this thread unlocks about the main idea>"}]}

Rules:
- every "query" must be a phrase a search engine resolves to the CONCEPT (e.g. "backpropagation", "discrete Fourier transform"), not a question and not the main idea itself;
- branch concepts must come from (or be directly demanded by) the seed material, not free association;
- a "context" branch is the LEAD-UP/backdrop the idea sits within -- a real peer topic with its own sources (e.g. "causes of the French Revolution", "single-variable calculus"), never a condescending "intro to X" or "X for beginners". Rank context candidates on two axes -- IMMEDIACY (how temporally/causally close to the idea) and VITALITY (how important to understanding it) -- and choose by the given CONTEXT-REACH: near 0, take only the single MOST IMMEDIATE lead-up even if narrow; toward 1, prefer the most VITAL, broader lead-up even if more distal. (E.g. for "Grover Cleveland's 1892 election": most immediate = the 1895 assassination of Korea's Queen Min by Japanese agents; broader and more vital = the First Sino-Japanese War and the Panic of 1893. Reach~0 -> just the assassination; reach~0.6 -> the war and the panic; reach~1 -> all three.);
- no duplicate or near-duplicate branches; each must earn its slot;
- "why" must state the RELATION to the main idea ("the math that makes X possible", "what X was invented to replace"), never teach the content itself.`;

const KIND_BUDGET: { ceiling: number; kinds: BranchKind[] }[] = [
  // The reach weight gates how far from the trunk the engine may wander, as
  // five stops (see ui/labels.ts REACH_LEVELS): close stays on the spine of
  // the idea; far opens the full iceberg out to debate and neighboring fields.
  { ceiling: 0.25, kinds: ['prerequisite', 'mechanism'] }, // Focused
  { ceiling: 0.45, kinds: ['prerequisite', 'mechanism', 'component'] }, // Depth
  { ceiling: 0.65, kinds: ['context', 'prerequisite', 'mechanism', 'component', 'application', 'foundation'] }, // Balanced
  { ceiling: 0.85, kinds: ['context', 'prerequisite', 'mechanism', 'component', 'application', 'foundation', 'frontier'] }, // Exploratory
  { ceiling: 1.01, kinds: ['context', 'prerequisite', 'mechanism', 'component', 'application', 'foundation', 'frontier', 'adjacent'] }, // Far-reaching
];

export function allowedKinds(radius: number): BranchKind[] {
  return KIND_BUDGET.find((b) => radius < b.ceiling)!.kinds;
}

export function branchBudget(radius: number): number {
  return 2 + Math.round(radius * 6); // 2..8 branches
}

/**
 * Context-reach maps the chosen radius onto a 0..1 axis FOR THE LEAD-UP arc:
 * Balanced (0.55) = 0, Far-reaching (0.95) = 1. At 0 the engine wants only the
 * single most IMMEDIATE lead-up; toward 1 it widens to the most VITAL lead-up,
 * even if broader and more distal. (War of 1812 / Cleveland 1892 framing.)
 */
export function contextReach(radius: number): number {
  return Math.max(0, Math.min(1, (radius - 0.55) / 0.4));
}

/** How many context (lead-up) branches at this reach: 1 (tight) .. 3 (wide). */
export function contextBudget(radius: number): number {
  return 1 + Math.round(contextReach(radius) * 2);
}

export function studyMapUser(
  query: string,
  radius: number,
  seedConcepts: string[],
  seedExcerpts: { title: string; text: string }[],
): string {
  const kinds = allowedKinds(radius).join(', ');
  const excerpts = seedExcerpts
    .map((e) => `--- from "${e.title}":\n${e.text}`)
    .join('\n\n');
  return `MAIN IDEA: ${query}

REACH (0 = stay tight on what the idea presupposes and contains; 1 = stretch to history, debates, neighboring fields): ${radius.toFixed(2)}
Allowed branch kinds at this reach: ${kinds}
Number of branches: at most ${branchBudget(radius)} -- fewer if the material doesn't demand more.
${
  allowedKinds(radius).includes('context')
    ? `Context (lead-up) branches: at most ${contextBudget(radius)}, by CONTEXT-REACH ${contextReach(radius).toFixed(2)} (0 = only the single most IMMEDIATE lead-up; 1 = the most VITAL, broader lead-up even if distal).`
    : ''
}

RECURRING TERMS across the seed sources (the corpus's own vocabulary):
${seedConcepts.join(', ')}

SEED EXCERPTS (verbatim, from real sources -- read these to form a consensus of what the main idea actually involves):
${excerpts}

Return the JSON study map now.`;
}
