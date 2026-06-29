// The New York Times (Article Search API) provider: mainstream reporting going
// back to 1851, so it pairs with Chronicling America (historic) and Wikinews /
// Guardian (modern) for the story across eras. The lead paragraph is the
// article's own words -- a verbatim doorway to the full piece. Free key,
// CORS-open; no key (or no reach) and it contributes nothing.

import type { Passage, SourceDoc } from '../types';
import { clampAtSentence, freshId, getJSONProxied } from './net';
import { loadSettings } from '../state/storage';

interface NytDoc {
  abstract?: string;
  lead_paragraph?: string;
  snippet?: string;
  web_url?: string;
  pub_date?: string;
  headline?: { main?: string };
  byline?: { original?: string };
}

export async function searchNYT(query: string): Promise<{ docs: SourceDoc[]; passages: Passage[] }> {
  const key = loadSettings().nytApiKey?.trim();
  if (!key) return { docs: [], passages: [] };

  const data = (await getJSONProxied(
    `https://api.nytimes.com/svc/search/v2/articlesearch.json?q=${encodeURIComponent(query)}` +
      `&sort=relevance&api-key=${encodeURIComponent(key)}`,
    12000,
  )) as { response?: { docs?: NytDoc[] } } | null;
  const items = data?.response?.docs ?? [];

  const docs: SourceDoc[] = [];
  const passages: Passage[] = [];
  for (const item of items) {
    const title = item.headline?.main?.trim();
    const url = item.web_url?.trim();
    // Lead paragraph is the article's own opening; fall back to the abstract.
    const text = (item.lead_paragraph || item.abstract || item.snippet || '').trim();
    if (!title || !url || text.length < 120) continue;
    const author = item.byline?.original?.replace(/^By\s+/i, '').trim() || undefined;
    const year = item.pub_date?.slice(0, 4);
    const doc: SourceDoc = {
      id: freshId('doc'),
      provider: 'The New York Times',
      sourceType: 'news',
      title,
      url,
      author,
      date: year && /^\d{4}$/.test(year) ? year : undefined,
    };
    docs.push(doc);
    passages.push({
      id: freshId('p'),
      docId: doc.id,
      text: clampAtSentence(text, 700, 1200),
      anchor: 'The New York Times',
      anchorUrl: url,
      index: 0,
    });
    if (docs.length >= 5) break;
  }
  return { docs, passages };
}
