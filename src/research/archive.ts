// Internet Archive provider: digitized books with their ACTUAL text. We search
// curated holdings only -- english language, never the unvetted "community
// texts" (opensource) uploads -- and require a public plain-text scan
// (format:DjVuTXT). Then we stream just the head of the book's text file and
// quote verbatim paragraphs that bear on the query, each pointing back to the
// item. This is the "full book used across the session" source: real pages,
// not catalog blurbs.

import type { Passage, SourceDoc } from '../types';
import {
  clampAtSentence,
  cleanOcr,
  fetchTextHead,
  freshId,
  getJSON,
  ocrQualityOk,
  queryTokens,
  relevanceOk,
} from './net';

interface IaDoc {
  identifier?: string;
  title?: string;
  creator?: string | string[];
  year?: number | string;
}

interface Scored {
  text: string;
  page: number;
  ordinal: number;
  hits: number;
}

// Curated holdings only -- library scans, government documents, early
// journals. The default full-text index reaches plenty of junk (and the
// "community texts" / opensource uploads are unvetted by design), so trust is
// enforced by an explicit collection allowlist, never by popularity.
const TRUSTED_COLLECTIONS =
  'americana OR internetarchivebooks OR library_of_congress OR jstor_ejc OR ' +
  'gutenberg OR cdl OR toronto OR universallibrary OR fedlink OR blc OR europeanlibraries';

export async function searchArchive(
  query: string,
  maxItems = 2,
  maxPassagesPerItem = 3,
): Promise<{ docs: SourceDoc[]; passages: Passage[] }> {
  const tokens = queryTokens(query);
  // AND the meaningful terms: archive search defaults to OR, which drifts
  // wildly off topic on popular-but-irrelevant items.
  const terms = tokens.length > 0 ? tokens.slice(0, 4).join(' AND ') : query;
  const q =
    `(${terms}) AND mediatype:(texts) AND language:(english OR eng) ` +
    `AND format:(DjVuTXT) AND collection:(${TRUSTED_COLLECTIONS}) ` +
    `AND -collection:(opensource) AND -collection:(community) ` +
    `AND -collection:(inlibrary) AND -access-restricted-item:(true)`;
  const data = (await getJSON(
    `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}` +
      `&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=creator&fl%5B%5D=year` +
      `&rows=8&page=1&output=json&sort%5B%5D=downloads+desc`,
  )) as { response?: { docs?: IaDoc[] } } | null;
  const found = (data?.response?.docs ?? []).filter((d) => d.identifier && d.title);

  type ItemResult = { doc: SourceDoc; passages: Passage[] };
  const results = await Promise.all(
    found.slice(0, maxItems + 2).map(async (item): Promise<ItemResult | null> => {
      const id = item.identifier!;
      const text = await fetchTextHead(`https://archive.org/download/${id}/${id}_djvu.txt`);
      if (!text || text.length < 2000) return null;

      // The text file is paged with form feeds; keep page numbers for anchors.
      const pages = text.split('\f');
      const candidates: Scored[] = [];
      let ordinal = 0;
      pages.forEach((pageText, pageIdx) => {
        for (const raw of pageText.split(/\n\s*\n/)) {
          ordinal += 1;
          const para = cleanOcr(raw);
          if (para.length < 320 || para.length > 1800) continue;
          if (!ocrQualityOk(para)) continue;
          if (!relevanceOk(para, tokens)) continue;
          const lower = para.toLowerCase();
          const hits = tokens.filter((t) => lower.includes(t)).length;
          candidates.push({ text: para, page: pageIdx + 1, ordinal, hits });
        }
      });
      if (candidates.length === 0) return null;

      // Spread picks across the fetched span (early / middle / late), so the
      // book contributes to more than one rung of the ladder.
      candidates.sort((a, b) => a.ordinal - b.ordinal);
      const picks: Scored[] = [];
      if (candidates.length <= maxPassagesPerItem) picks.push(...candidates);
      else {
        const step = (candidates.length - 1) / (maxPassagesPerItem - 1);
        for (let i = 0; i < maxPassagesPerItem; i++) {
          const c = candidates[Math.round(i * step)];
          if (!picks.includes(c)) picks.push(c);
        }
      }

      const author = Array.isArray(item.creator) ? item.creator[0] : item.creator;
      const doc: SourceDoc = {
        id: freshId('doc'),
        provider: 'Internet Archive',
        sourceType: 'book',
        title: String(item.title).slice(0, 110),
        url: `https://archive.org/details/${id}`,
        author,
        date: item.year ? String(item.year) : undefined,
        license: 'Digitized text — Internet Archive',
      };
      return {
        doc,
        passages: picks.map((p, i) => ({
          id: freshId('p'),
          docId: doc.id,
          text: clampAtSentence(p.text, 900, 1400),
          anchor: `Page ~${p.page}`,
          anchorUrl: doc.url,
          index: i,
        })),
      };
    }),
  );

  const docs: SourceDoc[] = [];
  const passages: Passage[] = [];
  for (const r of results) {
    if (!r || docs.length >= maxItems) continue;
    docs.push(r.doc);
    passages.push(...r.passages);
  }
  return { docs, passages };
}
