// OpenAlex provider: scholarly works with verbatim abstracts. OpenAlex is the
// open successor to Microsoft Academic Graph -- CORS-open, keyless, and it
// knows citation counts, which lets the canonical papers of a field (the
// "Attention Is All You Need"s) rise above merely-relevant ones. Abstracts
// are stored as an inverted index; we rebuild the authors' own words exactly.
//
// This module also resolves CITATIONS harvested from Wikipedia reference
// lists (see wikipage.ts): DOIs in one batched call, title lookups for
// arXiv-style references -- so the works a source itself leans on become
// real, readable sources in the weave.

import type { Passage, SourceDoc } from '../types';
import { loadSettings } from '../state/storage';
import { clampAtSentence, dropLeadingMeta, freshId, getJSON } from './net';

const API = 'https://api.openalex.org/works';
const FIELDS =
  'id,title,display_name,doi,publication_year,cited_by_count,authorships,abstract_inverted_index,primary_location';

/**
 * Per-user auth/polite-pool params from local settings, appended to every
 * OpenAlex request. The key never lives in source -- each user pastes their
 * own on the Settings screen and it stays in their browser's localStorage.
 */
function authParams(): string {
  const s = loadSettings();
  let out = '';
  if (s.openAlexApiKey) out += `&api_key=${encodeURIComponent(s.openAlexApiKey)}`;
  if (s.politeEmail) out += `&mailto=${encodeURIComponent(s.politeEmail)}`;
  return out;
}

interface OaWork {
  id?: string;
  title?: string;
  display_name?: string;
  doi?: string; // full https://doi.org/... form
  publication_year?: number;
  cited_by_count?: number;
  authorships?: { author?: { display_name?: string } }[];
  abstract_inverted_index?: Record<string, number[]> | null;
  primary_location?: { landing_page_url?: string };
}

/** OpenAlex stores abstracts as word -> positions; rebuild the verbatim text. */
function reconstructAbstract(inv: Record<string, number[]> | null | undefined): string {
  if (!inv) return '';
  const slots: { pos: number; w: string }[] = [];
  for (const [w, positions] of Object.entries(inv)) {
    for (const pos of positions) slots.push({ pos, w });
  }
  slots.sort((a, b) => a.pos - b.pos);
  return slots.map((s) => s.w).join(' ');
}

function workToSource(work: OaWork, provider: string): { doc: SourceDoc; passage: Passage } | null {
  const title = work.title ?? work.display_name;
  if (!title) return null;
  const raw = reconstructAbstract(work.abstract_inverted_index);
  if (raw.length < 200) return null;
  // Lead with the finding, not "This paper examines..." -- but a paper card is
  // still a doorway to the full work, so keep an all-preface abstract whole.
  const abstract = dropLeadingMeta(raw, 240) || raw;
  const url = work.primary_location?.landing_page_url ?? work.doi;
  if (!url) return null;
  const first = work.authorships?.[0]?.author?.display_name;
  const author = first
    ? first + ((work.authorships?.length ?? 0) > 1 ? ' et al.' : '')
    : undefined;
  const doc: SourceDoc = {
    id: freshId('doc'),
    provider,
    sourceType: 'paper',
    title,
    url,
    author,
    date: work.publication_year ? String(work.publication_year) : undefined,
  };
  return {
    doc,
    passage: {
      id: freshId('p'),
      docId: doc.id,
      text: clampAtSentence(abstract, 950, 1500),
      anchor: 'Abstract',
      anchorUrl: url,
      index: 0,
    },
  };
}

export async function searchOpenAlex(
  query: string,
  max = 5,
): Promise<{ docs: SourceDoc[]; passages: Passage[] }> {
  const data = (await getJSON(
    `${API}?search=${encodeURIComponent(query)}&per-page=12&select=${FIELDS}${authParams()}`,
  )) as { results?: OaWork[] } | null;
  const results = data?.results ?? [];

  // Rank: OpenAlex's relevance order, tempered by citation count -- a field's
  // landmark papers should beat a fresher but barely-cited title match.
  const scored = results
    .map((w, i) => ({ w, score: Math.log10(1 + (w.cited_by_count ?? 0)) - 0.35 * i }))
    .sort((a, b) => b.score - a.score);

  const docs: SourceDoc[] = [];
  const passages: Passage[] = [];
  for (const { w } of scored) {
    if (docs.length >= max) break;
    const made = workToSource(w, 'OpenAlex');
    if (!made) continue;
    docs.push(made.doc);
    passages.push(made.passage);
  }
  return { docs, passages };
}

// -- citation resolution (for Wikipedia reference harvesting) ----------------

export interface CitationRef {
  title?: string;
  doi?: string; // bare 10.xxxx/... form
  arxivId?: string;
  author?: string;
  year?: string;
}

/** Loose-but-safe title equality: same words, give or take a few. */
function titleMatches(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const wa = new Set(na.split(' '));
  const wb = new Set(nb.split(' '));
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return inter / Math.max(wa.size, wb.size) >= 0.75;
}

/**
 * Resolve harvested citations into sources with verbatim abstracts. All DOIs
 * go in ONE pipe-batched call; references that only carry a title (arXiv
 * cites, mostly) get individual title lookups, verified against the cited
 * title so a lookalike never slips in. The most-cited works win the slots.
 */
export async function resolveCitations(
  refs: CitationRef[],
  max = 8,
  provider = 'Cited by Wikipedia',
): Promise<{ docs: SourceDoc[]; passages: Passage[] }> {
  const works: OaWork[] = [];

  // Batch 1: every DOI in a single filter (pipe = OR, 50 per call). Commas
  // would read as filter separators, so the rare DOI containing one is skipped.
  const dois = [
    ...new Set(
      refs
        .map((r) => r.doi?.toLowerCase())
        .filter((d): d is string => !!d && !d.includes(',')),
    ),
  ].slice(0, 50);
  if (dois.length > 0) {
    const data = (await getJSON(
      `${API}?filter=doi:${dois.map(encodeURIComponent).join('|')}&per-page=50&select=${FIELDS}${authParams()}`,
      12000,
    )) as { results?: OaWork[] } | null;
    works.push(...(data?.results ?? []));
  }

  // Batch 2: title lookups for DOI-less references, in parallel, each verified.
  const titled = refs.filter((r) => !r.doi && r.title && r.title.length >= 12).slice(0, 8);
  const lookups = await Promise.all(
    titled.map(async (ref) => {
      const q = ref.title!.replace(/[,&]/g, ' ');
      const data = (await getJSON(
        `${API}?filter=title.search:${encodeURIComponent(q)}&sort=cited_by_count:desc&per-page=3&select=${FIELDS}${authParams()}`,
        10000,
      )) as { results?: OaWork[] } | null;
      const hit = (data?.results ?? []).find((w) =>
        titleMatches(w.title ?? w.display_name ?? '', ref.title!),
      );
      return hit ?? null;
    }),
  );
  works.push(...lookups.filter((w): w is OaWork => !!w));

  // Most-cited first: the references a topic's own article leans on hardest.
  works.sort((a, b) => (b.cited_by_count ?? 0) - (a.cited_by_count ?? 0));

  const docs: SourceDoc[] = [];
  const passages: Passage[] = [];
  const seenTitles = new Set<string>();
  for (const w of works) {
    if (docs.length >= max) break;
    const key = (w.title ?? '').toLowerCase();
    if (!key || seenTitles.has(key)) continue;
    const made = workToSource(w, provider);
    if (!made) continue;
    seenTitles.add(key);
    docs.push(made.doc);
    passages.push(made.passage);
  }
  return { docs, passages };
}
