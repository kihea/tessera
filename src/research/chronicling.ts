// Chronicling America (Library of Congress) provider: historic American
// newspapers, 1777-1963, with full OCR page text. A newspaper page is the
// topic IN ITS OWN TIME -- reporting written while it happened, which is depth
// material no encyclopedia restates. Excerpts are verbatim windows of the OCR
// around the query terms, quality-gated because scan quality varies.
//
// Uses the modern loc.gov JSON API (the legacy chroniclingamerica.loc.gov API
// does not send CORS headers). The page's OCR lives in an ALTO XML file on
// tile.loc.gov, whose URL is derivable from the search result's IIIF image id.

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

interface LocResult {
  title?: string;
  date?: string; // YYYY-MM-DD
  url?: string;
  image_url?: string | string[];
  language?: string[];
  access_restricted?: boolean;
}

/** Rebuild plain text from ALTO OCR XML (handles hyphenated line breaks). */
function altoToText(xml: string): string {
  const words: string[] = [];
  const re = /<String\b[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const tag = m[0];
    const subsType = /SUBS_TYPE="([^"]+)"/.exec(tag)?.[1];
    if (subsType === 'HypPart2') continue; // second half of a hyphenated word
    const content =
      subsType === 'HypPart1'
        ? /SUBS_CONTENT="([^"]*)"/.exec(tag)?.[1]
        : /CONTENT="([^"]*)"/.exec(tag)?.[1];
    if (content) words.push(content);
  }
  return words
    .join(' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/** IIIF image id -> the page's ALTO XML on the storage service. */
function altoUrlFrom(imageUrl: string | string[] | undefined): string | null {
  const img = Array.isArray(imageUrl) ? imageUrl[0] : imageUrl;
  const m = /image-services\/iiif\/service:([^/]+)/.exec(img ?? '');
  if (!m) return null;
  return `https://tile.loc.gov/storage-services/service/${m[1].replace(/:/g, '/')}.xml`;
}

export async function searchChronicling(
  query: string,
  max = 4,
): Promise<{ docs: SourceDoc[]; passages: Passage[] }> {
  // `q=` is the param that actually full-text searches this collection
  // (`qs=` silently ignores the query). Cold queries can take >10s at LoC,
  // hence the long timeout; the fan-out shows this provider as pending.
  const data = (await getJSON(
    `https://www.loc.gov/collections/chronicling-america/?q=${encodeURIComponent(query)}&fo=json&c=10`,
    16000,
  )) as { results?: LocResult[] } | null;
  const tokens = queryTokens(query);

  const candidates = (data?.results ?? []).filter(
    (r) =>
      r.title &&
      r.url &&
      !r.access_restricted &&
      (r.language ?? []).some((l) => /english/i.test(l)) &&
      altoUrlFrom(r.image_url),
  );

  const fetched = await Promise.all(
    candidates.slice(0, max + 2).map(async (res) => {
      const xml = await fetchTextHead(altoUrlFrom(res.image_url)!, 380000);
      if (!xml) return null;
      const text = cleanOcr(altoToText(xml));
      if (text.length < 400) return null;

      // Try a window around each query term's first hit; keep the most
      // on-topic one that survives the OCR-quality and relevance gates.
      const lower = text.toLowerCase();
      let best: { excerpt: string; score: number } | null = null;
      for (const t of tokens) {
        const at = lower.indexOf(t);
        if (at < 0) continue;
        const windowRaw = text.slice(Math.max(0, at - 450), at + 750).trim();
        const startAdj = windowRaw.search(/[A-Z]/);
        const excerpt = clampAtSentence(windowRaw.slice(Math.max(0, startAdj)), 600, 900);
        if (!ocrQualityOk(excerpt) || !relevanceOk(excerpt, tokens)) continue;
        const exLower = excerpt.toLowerCase();
        const score = tokens.filter((tk) => exLower.includes(tk)).length;
        if (!best || score > best.score) best = { excerpt, score };
      }
      if (!best) return null;
      return { res, excerpt: best.excerpt };
    }),
  );

  const docs: SourceDoc[] = [];
  const passages: Passage[] = [];
  const seenPage = new Set<string>();
  for (const hit of fetched) {
    if (!hit || docs.length >= max) continue;
    const { res, excerpt } = hit;
    const title = res.title!.replace(/^Image \d+ of /i, '');
    if (seenPage.has(title)) continue; // one passage per paper+day
    seenPage.add(title);
    const url = res.url!.replace(/^\/\//, 'https://').replace(/^http:/, 'https:');
    const doc: SourceDoc = {
      id: freshId('doc'),
      provider: 'Chronicling America',
      sourceType: 'news',
      title,
      url,
      date: res.date,
      license: 'Public domain (Library of Congress)',
    };
    docs.push(doc);
    passages.push({
      id: freshId('p'),
      docId: doc.id,
      text: excerpt,
      anchor: 'Newspaper page (OCR)',
      anchorUrl: url,
      index: 0,
    });
  }
  return { docs, passages };
}
