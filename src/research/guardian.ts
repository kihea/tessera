// The Guardian (Open Platform) provider: mainstream modern news with the
// article's own body text, so a card carries a verbatim excerpt and links to
// the full piece. Free developer key, CORS-open; keyless (or web with no key)
// it simply contributes nothing. The key stays in this browser's localStorage.

import type { Passage, SourceDoc } from '../types';
import { clampAtSentence, freshId, getJSONProxied, stripHtml } from './net';
import { loadSettings } from '../state/storage';

interface GuardianItem {
  webTitle?: string;
  webUrl?: string;
  webPublicationDate?: string;
  fields?: { trailText?: string; bodyText?: string; byline?: string };
}

export async function searchGuardian(
  query: string,
  rows = 8,
): Promise<{ docs: SourceDoc[]; passages: Passage[] }> {
  const key = loadSettings().guardianApiKey?.trim();
  if (!key) return { docs: [], passages: [] };

  const data = (await getJSONProxied(
    `https://content.guardianapis.com/search?q=${encodeURIComponent(query)}` +
      `&order-by=relevance&page-size=${rows}&show-fields=trailText,bodyText,byline,firstPublicationDate` +
      `&api-key=${encodeURIComponent(key)}`,
    12000,
  )) as { response?: { results?: GuardianItem[] } } | null;
  const items = data?.response?.results ?? [];

  const docs: SourceDoc[] = [];
  const passages: Passage[] = [];
  for (const item of items) {
    const title = item.webTitle?.trim();
    const url = item.webUrl?.trim();
    const body = (item.fields?.bodyText || stripHtml(item.fields?.trailText ?? '')).trim();
    if (!title || !url || body.length < 200) continue;
    const year = item.webPublicationDate?.slice(0, 4);
    const doc: SourceDoc = {
      id: freshId('doc'),
      provider: 'The Guardian',
      sourceType: 'news',
      title,
      url,
      author: item.fields?.byline?.trim() || undefined,
      date: year && /^\d{4}$/.test(year) ? year : undefined,
    };
    docs.push(doc);
    passages.push({
      id: freshId('p'),
      docId: doc.id,
      text: clampAtSentence(body, 950, 1500),
      anchor: 'The Guardian',
      anchorUrl: url,
      index: 0,
    });
    if (docs.length >= 5) break;
  }
  return { docs, passages };
}
