// Open Library provider: books as "go deeper" pointers. The card text is the
// book's own first sentence when the catalog has one -- still verbatim source
// material, and the card is primarily a doorway to the full work.

import type { Passage, SourceDoc } from '../types';
import { freshId, getJSON } from './net';

interface OlDoc {
  title?: string;
  author_name?: string[];
  first_publish_year?: number;
  key?: string; // e.g. /works/OL123W
  first_sentence?: string[] | string;
  subject?: string[];
}

export async function searchOpenLibrary(query: string, max = 2): Promise<{ docs: SourceDoc[]; passages: Passage[] }> {
  const data = (await getJSON(
    `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=10&fields=title,author_name,first_publish_year,key,first_sentence,subject`,
  )) as { docs?: OlDoc[] } | null;
  const found = data?.docs ?? [];

  const docs: SourceDoc[] = [];
  const passages: Passage[] = [];
  for (const b of found) {
    if (docs.length >= max) break;
    if (!b.title || !b.key) continue;
    const sentence = Array.isArray(b.first_sentence) ? b.first_sentence[0] : b.first_sentence;
    if (!sentence || sentence.length < 60) continue; // only books that bring real text
    const doc: SourceDoc = {
      id: freshId('doc'),
      provider: 'Open Library',
      sourceType: 'book',
      title: b.title,
      url: `https://openlibrary.org${b.key}`,
      author: b.author_name?.[0],
      date: b.first_publish_year ? String(b.first_publish_year) : undefined,
    };
    docs.push(doc);
    passages.push({
      id: freshId('p'),
      docId: doc.id,
      text: sentence,
      anchor: 'Opening line',
      anchorUrl: doc.url,
      index: 0,
    });
  }
  return { docs, passages };
}
