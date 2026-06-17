// Crossref provider: scholarly paper abstracts. An abstract is the authors'
// own verbatim words about their work, so it qualifies as source material,
// and the DOI link leads to the full paper.

import type { Passage, SourceDoc } from '../types';
import { clampAtSentence, dropLeadingMeta, freshId, getJSON, stripHtml } from './net';

interface CrossrefItem {
  title?: string[];
  abstract?: string;
  URL?: string;
  DOI?: string;
  author?: { given?: string; family?: string }[];
  issued?: { 'date-parts'?: number[][] };
  'container-title'?: string[];
}

export async function searchCrossref(query: string, rows = 6): Promise<{ docs: SourceDoc[]; passages: Passage[] }> {
  const data = (await getJSON(
    `https://api.crossref.org/works?query=${encodeURIComponent(query)}&filter=has-abstract:true&rows=${rows}` +
      `&select=title,abstract,URL,DOI,author,issued,container-title`,
  )) as { message?: { items?: CrossrefItem[] } } | null;
  const items = data?.message?.items ?? [];

  const docs: SourceDoc[] = [];
  const passages: Passage[] = [];
  for (const item of items) {
    const title = item.title?.[0];
    const url = item.URL ?? (item.DOI ? `https://doi.org/${item.DOI}` : undefined);
    if (!title || !url || !item.abstract) continue;
    const raw = stripHtml(item.abstract).replace(/^abstract\.?\s*/i, '');
    // Lead with the finding, not "This paper examines...". If the whole thing
    // is preface, keep it -- a paper card is still a doorway to the full work.
    const abstract = dropLeadingMeta(raw, 240) || raw;
    if (abstract.length < 200) continue;
    const first = item.author?.[0];
    const author = first ? [first.given, first.family].filter(Boolean).join(' ') + (item.author!.length > 1 ? ' et al.' : '') : undefined;
    const year = item.issued?.['date-parts']?.[0]?.[0];
    const doc: SourceDoc = {
      id: freshId('doc'),
      provider: 'Crossref',
      sourceType: 'paper',
      title,
      url,
      author,
      date: year ? String(year) : undefined,
    };
    docs.push(doc);
    passages.push({
      id: freshId('p'),
      docId: doc.id,
      text: clampAtSentence(abstract, 950, 1500),
      anchor: item['container-title']?.[0] ? `Abstract — ${item['container-title']![0]}` : 'Abstract',
      anchorUrl: url,
      index: 0,
    });
    if (docs.length >= 4) break;
  }
  return { docs, passages };
}
