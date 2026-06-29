// Hacker News (Algolia) provider: real discussion -- practitioners arguing,
// qualifying, and pushing back. Each comment is quoted verbatim and linked to
// its thread. This is where 'contrasts' and 'questions' threads tend to live.

import type { Passage, SourceDoc } from '../types';
import { clampAtSentence, freshId, getJSON, stripHtml } from './net';

interface HnHit {
  objectID: string;
  comment_text?: string;
  story_title?: string;
  story_id?: number;
  author?: string;
  created_at?: string;
}

export async function searchHN(query: string, max = 6): Promise<{ docs: SourceDoc[]; passages: Passage[] }> {
  const data = (await getJSON(
    `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=comment&hitsPerPage=24`,
  )) as { hits?: HnHit[] } | null;
  const hits = data?.hits ?? [];

  const docs: SourceDoc[] = [];
  const passages: Passage[] = [];
  for (const hit of hits) {
    if (docs.length >= max) break;
    if (!hit.comment_text || !hit.story_title) continue;
    const text = stripHtml(hit.comment_text);
    if (text.length < 220 || text.length > 1600) continue;
    if (/^\s*>/.test(hit.comment_text)) continue; // skip pure quote-replies
    const doc: SourceDoc = {
      id: freshId('doc'),
      provider: 'Hacker News',
      sourceType: 'discussion',
      title: `Comment on “${hit.story_title}”`,
      url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
      author: hit.author,
      date: hit.created_at?.slice(0, 10),
    };
    docs.push(doc);
    passages.push({
      id: freshId('p'),
      docId: doc.id,
      text: clampAtSentence(text, 600, 900),
      anchor: 'Discussion thread',
      anchorUrl: doc.url,
      index: 0,
    });
  }
  return { docs, passages };
}
