// Fan-out research orchestrator. All providers run in parallel, each is
// best-effort, and progress is reported per provider so the user can see
// exactly where the material is coming from (transparency builds trust).

import type { Formula, Passage, ProviderProgress, SourceDoc } from '../types';
import { searchArchive } from './archive';
import { searchChronicling } from './chronicling';
import { searchCrossref } from './crossref';
import { searchHN } from './hn';
import { searchGuardian } from './guardian';
import { searchNYT } from './nyt';
import { searchGNews } from './gnews';
import { searchOpenLibrary } from './openlibrary';
import { resolveCitations, searchOpenAlex } from './openalex';
import { seedTitlesFor } from './seeds';
import { searchWiki } from './wiki';
import { harvestWikiPages } from './wikipage';
import { searchYouTube } from './youtube';
import { searchScholar } from './scholar';
import { searchBakedVideos } from './bakedVideos';
import { dropLeadingMeta } from './net';
import { filterToDominantLanguage } from './lang';
import { graphProviderSearch } from '../state/graphStore';
import { loadSettings } from '../state/storage';

export interface ResearchResult {
  docs: SourceDoc[];
  passages: Passage[];
  formulas: Formula[];
}

interface ProviderResult {
  docs: SourceDoc[];
  passages: Passage[];
}

type ProgressFn = (update: ProviderProgress) => void;

// Larger pool than before: full sources should be used ACROSS the length of a
// session, not reduced to a couple of lead snippets. The loom paces them out.
const MAX_TOTAL_PASSAGES = 96;

/**
 * Sense-coherence re-rank: drop clearly off-domain outliers from sense-drift-prone
 * providers (papers / discussion / news) when a canonical sense is well established
 * by Wikipedia. This fixes technical queries like "multifactor models" pulling legal
 * "multifactor test" papers: the Wikipedia (finance/stats) passages set the sense, a
 * legal paper shares almost none of that vocabulary, so it is removed. Deliberately
 * conservative -- only with a strong canon (>=4 wiki passages), only drift-prone
 * providers, only clear outliers; encyclopedia/textbook/book/primary are always kept.
 */
function senseRerank(passages: Passage[], docs: SourceDoc[]): Passage[] {
  const docById = new Map(docs.map((d) => [d.id, d] as const));
  const canon = passages.filter((p) => docById.get(p.docId)?.provider.startsWith('Wikipedia'));
  if (canon.length < 4) return passages; // no strong canonical sense -> don't touch
  const profile = new Map<string, number>();
  for (const p of canon) for (const w of wordSet(p.text)) profile.set(w, (profile.get(w) ?? 0) + 1);
  const coherence = (p: Passage): number => {
    const ws = [...wordSet(p.text)];
    if (ws.length === 0) return 1;
    let s = 0;
    for (const w of ws) s += profile.get(w) ?? 0;
    return s / ws.length;
  };
  const canonCoh = canon.map(coherence).sort((a, b) => a - b);
  const floor = 0.25 * (canonCoh[Math.floor(canonCoh.length / 2)] || 0);
  const driftProne = new Set(['paper', 'discussion', 'news']);
  return passages.filter((p) => {
    const d = docById.get(p.docId);
    if (!d || !driftProne.has(d.sourceType)) return true; // keep canonical/textbook/book/primary
    return coherence(p) >= floor; // drop clear off-domain papers/discussion/news
  });
}

export async function research(query: string, onProgress: ProgressFn): Promise<ResearchResult> {
  let formulas: Formula[] = [];

  // Wikipedia runs ONCE; its top pages then seed a second-stage harvest of the
  // works those articles themselves cite (the topic's canonical reading list)
  // and of their rendered equations.
  const wikipediaRun = searchWiki(query, 'en.wikipedia.org', 'encyclopedia', 'Wikipedia', 3, 11);

  // Order = keep-priority for the near-duplicate filter below: when two
  // sources say the same thing, the cleaner/more canonical text wins.
  const providers: { name: string; run: () => Promise<ProviderResult> }[] = [
    {
      name: 'Wikipedia',
      run: () => wikipediaRun,
    },
    // Your own knowledge graph, pulled alongside the live sources: verbatim material
    // you've already gathered ON THIS EXACT TOPIC. OPT-IN (default off): left on, it
    // injected the local graph's dominant cluster into every feed (the "video games /
    // periodic table for every query" bug), especially when live providers were thin.
    // Now off by default AND drift-proof (graphProviderSearch: no expansion).
    ...(loadSettings().dev?.graphProvider === true
      ? [{ name: 'Your knowledge graph', run: () => graphProviderSearch(query) }]
      : []),
    {
      name: 'Wikibooks',
      run: () => searchWiki(query, 'en.wikibooks.org', 'textbook', 'Wikibooks', 2, 7),
    },
    {
      name: 'Wikisource',
      run: () => searchWiki(query, 'en.wikisource.org', 'primary', 'Wikisource', 2, 5),
    },
    { name: 'OpenAlex papers', run: () => searchOpenAlex(query) },
    {
      name: 'Cited works',
      run: async () => {
        const wiki = await wikipediaRun.catch(() => ({ docs: [], passages: [] }));
        const titles = wiki.docs.slice(0, 2).map((d) => d.title);
        const harvest =
          titles.length > 0 ? await harvestWikiPages(titles) : { citations: [], formulas: [] };
        formulas = harvest.formulas;
        // Curated canonical works for broad fields lead the lookup queue --
        // sparingly seeded, organically verified (see seeds.ts).
        const seeds = seedTitlesFor(query).map((title) => ({ title }));
        return resolveCitations([...seeds, ...harvest.citations]);
      },
    },
    { name: 'Crossref', run: () => searchCrossref(query) },
    // After the abstract providers: Scholar's snippet is a short, truncated
    // excerpt, so when it mirrors a fuller OpenAlex/Crossref abstract the fuller
    // verbatim text wins the dedup. Desktop-only, keyed via SerpApi (see scholar.ts).
    { name: 'Google Scholar', run: () => searchScholar(query) },
    { name: 'Hacker News', run: () => searchHN(query) },
    { name: 'Open Library', run: () => searchOpenLibrary(query) },
    // News across eras of real journalism. Wikinews (2004–present) and
    // Chronicling America (historic US papers) are keyless; The Guardian, NYT,
    // and GNews are opt-in keyed providers that no-op until a key is added
    // (Settings → Sources). Hacker News is DISCUSSION, never a stand-in for news.
    { name: 'Wikinews', run: () => searchWiki(query, 'en.wikinews.org', 'news', 'Wikinews', 2, 4) },
    { name: 'Chronicling America', run: () => searchChronicling(query) },
    { name: 'The Guardian', run: () => searchGuardian(query) },
    { name: 'New York Times', run: () => searchNYT(query) },
    { name: 'GNews', run: () => searchGNews(query) },
    { name: 'Internet Archive', run: () => searchArchive(query) },
    // Curated intro videos: keyless + offline, so it works in web AND desktop;
    // trusted channels, embedded whole. The reliable backbone of the video feed.
    { name: 'Videos', run: async () => searchBakedVideos(query) },
    // Last: live transcript snippets are chatty, so cleaner text wins the dedup;
    // a no-op unless on the desktop app with a YouTube key configured.
    { name: 'YouTube', run: () => searchYouTube(query) },
  ];

  for (const p of providers) onProgress({ name: p.name, status: 'pending', passages: 0 });

  const settled = await Promise.all(
    providers.map(async (p) => {
      try {
        const result = await p.run();
        onProgress({ name: p.name, status: 'ok', passages: result.passages.length });
        return result;
      } catch {
        onProgress({ name: p.name, status: 'fail', passages: 0 });
        return { docs: [], passages: [] };
      }
    }),
  );

  const docs: SourceDoc[] = [];
  const collected: Passage[] = [];
  const seenText = new Set<string>();
  const keptWordSets: Set<string>[] = [];
  for (const result of settled) {
    docs.push(...result.docs);
    for (const passage of result.passages) {
      // Final meta-discourse pass: a passage that only describes its document
      // ("Chapter 2 delves into...") carries no content -- drop it.
      const trimmed = dropLeadingMeta(passage.text, 140);
      if (!trimmed) continue;
      passage.text = trimmed;
      const key = passage.text.slice(0, 90).toLowerCase();
      if (seenText.has(key)) continue; // exact mirrors
      // Near-duplicate filter: different sources restating the same content
      // (mirrored wiki text, overlapping abstracts) add repetition, not
      // perspective. Earlier providers win, so the canonical copy survives.
      const words = wordSet(passage.text);
      // Embed-bearing (video) passages carry the iframe the feed exists to show;
      // never drop one as a near-duplicate of longer prose.
      if (!passage.embed && keptWordSets.some((kept) => nearDuplicate(words, kept))) continue;
      seenText.add(key);
      keptWordSets.push(words);
      collected.push(passage);
    }
  }

  // Keep the corpus in one language (papers especially can come back in
  // another), then cap. Prune docs left with no surviving passages.
  const kept = senseRerank(filterToDominantLanguage(collected), docs).slice(0, MAX_TOTAL_PASSAGES);
  const liveDocs = new Set(kept.map((p) => p.docId));
  return { docs: docs.filter((d) => liveDocs.has(d.id)), passages: kept, formulas };
}

export function wordSet(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? []);
}

/** Jaccard overlap, plus containment so a short restatement of a long passage counts. */
export function nearDuplicate(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const w of small) if (large.has(w)) inter++;
  const jaccard = inter / (a.size + b.size - inter);
  const containment = inter / small.size;
  return jaccard >= 0.5 || containment >= 0.72;
}
