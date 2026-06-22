// GNews provider: a keyed aggregator across many outlets, for breadth of
// modern coverage beyond any single paper. Free tier is rate-limited and
// returns a truncated snippet, so cards lead with the article's own
// description/lead and link out for the rest. No key and it contributes
// nothing; best-effort like every provider.

import type { Passage, SourceDoc } from '../types';
import { clampAtSentence, freshId, getJSONProxied } from './net';
import { loadSettings } from '../state/storage';

interface GNewsArticle {
  title?: string;
  description?: string;
  content?: string;
  url?: string;
  publishedAt?: string;
  source?: { name?: string };
}

/** GNews appends "… [1234 chars]" to truncated content; drop that marker. */
function cleanContent(s: string | undefined): string {
  return (s ?? '').replace(/\s*\[\+?\d+\s*chars\]\s*$/i, '').trim();
}

export async function searchGNews(query: string): Promise<{ docs: SourceDoc[]; passages: Passage[] }> {
  const key = loadSettings().gnewsApiKey?.trim();
  if (!key) return { docs: [], passages: [] };

  const data = (await getJSONProxied(
    `https://gnews.io/api/v4/search?q=${encodeURIComponent(query)}&lang=en&max=8&token=${encodeURIComponent(key)}`,
    12000,
  )) as { articles?: GNewsArticle[] } | null;
  const items = data?.articles ?? [];

  const docs: SourceDoc[] = [];
  const passages: Passage[] = [];
  for (const item of items) {
    const title = item.title?.trim();
    const url = item.url?.trim();
    const content = cleanContent(item.content);
    const desc = item.description?.trim() ?? '';
    // Prefer whichever of the two snippets carries more of the article.
    const text = (content.length > desc.length ? content : desc).trim();
    if (!title || !url || text.length < 120) continue;
    const year = item.publishedAt?.slice(0, 4);
    const doc: SourceDoc = {
      id: freshId('doc'),
      provider: item.source?.name ? `GNews · ${item.source.name}` : 'GNews',
      sourceType: 'news',
      title,
      url,
      date: year && /^\d{4}$/.test(year) ? year : undefined,
    };
    docs.push(doc);
    passages.push({
      id: freshId('p'),
      docId: doc.id,
      text: clampAtSentence(text, 600, 1000),
      anchor: item.source?.name ?? 'GNews',
      anchorUrl: url,
      index: 0,
    });
    if (docs.length >= 5) break;
  }
  return { docs, passages };
}
