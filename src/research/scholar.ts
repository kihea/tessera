// Google Scholar source feed. Scholar has no official API and is CORS-blocked
// from the browser, so — exactly like the YouTube feed — discovery routes
// through the Tauri Rust core and goes out via SerpApi's `google_scholar`
// engine, with a SerpApi key the user pastes on the Settings screen. The
// pure-web build, or a missing key, yields nothing: the feed degrades
// gracefully, just like every other provider.
//
// What we keep is Scholar's own result snippet — a short, already-public
// excerpt of the work — shown verbatim as a doorway into the full paper at its
// real link. We never reproduce a paper's body; the snippet points the learner
// to the source, the way a Crossref/OpenAlex abstract card does.

import type { Passage, SourceDoc } from '../types';
import { clampAtSentence, freshId, queryTokens, relevanceOk } from './net';
import { loadSettings } from '../state/storage';

const inTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const MAX_RESULTS = 6;

/** One Scholar result as the Rust core hands it back (a thin slice of SerpApi). */
interface ScholarItem {
  title?: string;
  link?: string;
  snippet?: string;
  /** SerpApi's publication_info.summary, e.g. "A Smith, B Jones - Nature, 2019 - nature.com". */
  summary?: string;
  citedBy?: number;
}

async function tauriInvoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

/**
 * Pull author and year out of Scholar's "summary" line. The shape is reliably
 * "Authors - Venue, Year - host"; we take the lead author (with "et al." when
 * there are more) and the first 4-digit year. Best-effort: missing parts just
 * stay undefined, never block the card.
 */
function parseSummary(summary: string | undefined): { author?: string; date?: string } {
  if (!summary) return {};
  const authorPart = summary.split(' - ')[0]?.trim();
  const author =
    authorPart && /[A-Za-z]/.test(authorPart)
      ? authorPart.split(',')[0].trim() + (authorPart.includes(',') ? ' et al.' : '')
      : undefined;
  const year = summary.match(/\b(1[5-9]\d\d|20\d\d)\b/)?.[0];
  return { author, date: year };
}

export async function searchScholar(query: string): Promise<{ docs: SourceDoc[]; passages: Passage[] }> {
  const empty = { docs: [] as SourceDoc[], passages: [] as Passage[] };
  if (!inTauri()) return empty; // CORS: desktop app only
  const apiKey = loadSettings().serpApiKey?.trim();
  if (!apiKey) return empty; // feature off until a key is added

  let items: ScholarItem[];
  try {
    items = (await tauriInvoke<ScholarItem[]>('scholar_search', { query, apiKey, max: MAX_RESULTS })) ?? [];
  } catch {
    return empty;
  }

  const tokens = queryTokens(query);
  const docs: SourceDoc[] = [];
  const passages: Passage[] = [];

  // Rank by citation count: a field's landmark works should lead, the way they
  // do for OpenAlex. SerpApi returns Scholar's own relevance order; we only
  // nudge the most-cited up among the returned set.
  const ranked = [...items].sort((a, b) => (b.citedBy ?? 0) - (a.citedBy ?? 0));

  for (const item of ranked) {
    const title = item.title?.trim();
    const url = item.link?.trim();
    const snippet = item.snippet?.replace(/\s+/g, ' ').trim();
    // A result with no readable host page, or no snippet to quote, is just a
    // dead link on a card -- skip it. Off-topic snippets are dropped too.
    if (!title || !url || !snippet || snippet.length < 80) continue;
    if (!relevanceOk(snippet, tokens)) continue;

    const { author, date } = parseSummary(item.summary);
    const doc: SourceDoc = {
      id: freshId('gs'),
      provider: 'Google Scholar',
      sourceType: 'paper',
      title,
      url,
      author,
      date,
    };
    docs.push(doc);
    passages.push({
      id: freshId('gs-p'),
      docId: doc.id,
      // Scholar's snippet is short and already public; keep it whole as the
      // doorway, the link carries the rest.
      text: clampAtSentence(snippet, 300, 480),
      anchor: 'Google Scholar',
      anchorUrl: url,
      index: 0,
    });
  }

  return { docs, passages };
}
