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
function heuristicStudyMap(query: string, seedConcepts: Concept[], radius: number): StudyMap {
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
  if (kinds.has('foundation')) {
    branches.push({
      kind: 'foundation',
      concept: `history of the idea`,
      query: `history of ${query}`,
      why: `Where “${query}” came from — the problems it was invented to solve.`,
    });
  }
  if (kinds.has('frontier')) {
    branches.push({
      kind: 'frontier',
      concept: 'debates and criticism',
      query: `${query} criticism controversy`,
      why: `What experts argue about — the live edges of “${query}”.`,
    });
  }

  // Concept branches: prefer specific multi-word terms and acronyms -- they
  // resolve to their own real articles ("machine learning"), where bare
  // common unigrams ("machine", "human") splinter the same ground.
  const branchScore = (c: Concept) =>
    c.weight * c.df * (c.id.includes(' ') || c.label === c.label.toUpperCase() ? 2.4 : 1);
  const candidates = seedConcepts
    .filter((c) => c.important)
    .filter((c) => !c.id.split(' ').some((w) => queryWords.has(w)))
    .filter((c) => c.id.includes(' ') || c.label === c.label.toUpperCase() || c.id.length >= 5)
    .sort((a, b) => branchScore(b) - branchScore(a));
  for (const c of candidates) {
    if (branches.length >= budget) break;
    branches.push({
      kind: 'component',
      concept: c.label,
      query: c.label,
      why: `“${c.label}” recurs across your seed sources — gathering material that explains it in its own right.`,
    });
  }

  return { idea: query, branches: branches.slice(0, budget), builtBy: 'heuristic' };
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
    const reply = await complete(STUDY_MAP_SYSTEM, studyMapUser(query, radius, conceptLabels, leads), {
      maxTokens: 1200,
      onProgress: onModelProgress,
    });
    if (reply) {
      const map = sanitizeModelMap(extractJson<RawMap>(reply), query, radius);
      if (map) return map;
    }
  }
  return heuristicStudyMap(query, seedConcepts, radius);
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
): Promise<BranchResearch> {
  const deepKinds = new Set(['context', 'mechanism', 'frontier', 'foundation']);
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
        const [wiki, papers] = await Promise.all([
          searchWiki(branch.query, 'en.wikipedia.org', 'encyclopedia', 'Wikipedia', branchPages, branchPassages),
          wantPapers
            ? searchOpenAlex(branch.query, paperCount)
            : Promise.resolve({ docs: [], passages: [] }),
        ]);
        const docs = [...wiki.docs, ...papers.docs];
        for (const doc of docs) {
          doc.branch = { kind: branch.kind, concept: branch.concept, why: branch.why };
        }
        const passages = [...wiki.passages, ...papers.passages];
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
