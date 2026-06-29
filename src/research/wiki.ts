// Wikipedia + Wikibooks provider (same MediaWiki API, different host).
// We pull full plain-text extracts and slice them into verbatim section
// passages, each deep-linked to its section anchor. CC BY-SA attribution.

import type { Passage, SourceDoc, SourceType } from '../types';
import { clampAtSentence, dropLeadingMeta, freshId, getJSON, isMetaSentence } from './net';

const SKIP_SECTIONS =
  /^(references|external links|see also|further reading|notes|footnotes|bibliography|sources|citations|gallery|works cited)$/i;

interface WikiResult {
  docs: SourceDoc[];
  passages: Passage[];
}

interface SectionChunk {
  section: string;
  text: string;
}

function splitSections(extract: string): SectionChunk[] {
  const out: SectionChunk[] = [];
  let current = 'Overview';
  let buf: string[] = [];
  const flush = () => {
    const text = buf.join('\n').trim();
    if (text && !SKIP_SECTIONS.test(current)) out.push({ section: current, text });
    buf = [];
  };
  for (const line of extract.split('\n')) {
    const m = line.match(/^=+\s*(.+?)\s*=+\s*$/);
    if (m) {
      flush();
      current = m[1];
    } else {
      buf.push(line);
    }
  }
  flush();
  return out;
}

function paragraphs(text: string): string[] {
  return text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 180 && !/^\|/.test(p) && !isMetaSentence(p));
}

/** Rendered HTML -> plain text, KEEPING paragraph boundaries. */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<(sup|table)[\s\S]*?<\/\1>/gi, ' ') // footnote markers, layout tables
    .replace(/<\/(p|div|h\d|li|tr|blockquote)>/gi, '\n\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#160;|&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Wikisource renders most works by transcluding proofread scan pages, which
 * the TextExtracts API cannot expand (it returns ''). action=parse renders
 * the real text, so primary sources actually contribute passages.
 */
async function parsePlainText(api: string, pageid: number): Promise<string | null> {
  const data = (await getJSON(
    `${api}?action=parse&pageid=${pageid}&prop=text&format=json&origin=*`,
    12000,
  )) as { parse?: { text?: { '*'?: string } } } | null;
  const html = data?.parse?.text?.['*'];
  return html ? htmlToText(html) : null;
}

export async function searchWiki(
  query: string,
  host: 'en.wikipedia.org' | 'en.wikibooks.org' | 'en.wikisource.org' | 'en.wikinews.org',
  sourceType: SourceType,
  provider: string,
  maxPages: number,
  maxPassagesPerPage: number,
): Promise<WikiResult> {
  const api = `https://${host}/w/api.php`;
  const search = (await getJSON(
    `${api}?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=${maxPages + 2}&format=json&origin=*`,
  )) as { query?: { search?: { pageid: number; title: string }[] } } | null;
  const hits = search?.query?.search ?? [];
  if (hits.length === 0) return { docs: [], passages: [] };

  const ids = hits.slice(0, maxPages).map((h) => h.pageid);
  const pages = (await getJSON(
    `${api}?action=query&prop=extracts|info&explaintext=1&exlimit=max&inprop=url&pageids=${ids.join('|')}&format=json&origin=*`,
  )) as {
    query?: { pages?: Record<string, { pageid: number; title: string; extract?: string; fullurl?: string }> };
  } | null;
  const pageMap = pages?.query?.pages ?? {};

  const docs: SourceDoc[] = [];
  const passages: Passage[] = [];
  for (const id of ids) {
    const page = pageMap[String(id)];
    if (!page) continue;
    // Wikisource works are transcluded from scans, so extracts come back
    // empty -- render the page instead. Other hosts always have extracts.
    let extract = page.extract;
    if (!extract && host === 'en.wikisource.org') {
      extract = (await parsePlainText(api, page.pageid)) ?? undefined;
    }
    if (!extract) continue;
    const url = page.fullurl ?? `https://${host}/?curid=${page.pageid}`;
    const doc: SourceDoc = {
      id: freshId('doc'),
      provider,
      sourceType,
      title: page.title,
      url,
      license:
        host === 'en.wikisource.org'
          ? 'Public domain (Wikisource)'
          : host === 'en.wikinews.org'
            ? 'CC BY 2.5 (Wikinews)'
            : 'CC BY-SA 4.0',
    };
    // Collect candidates across the WHOLE document, then take a spread:
    // lead/overview material AND mid-document mechanics AND late sections
    // (applications, criticism). A mastery ladder needs every rung present --
    // snipping only the top of each article would flatten the corpus.
    const sections = splitSections(extract.slice(0, 48000));
    const candidates: { section: string; para: string; sectionOrdinal: number }[] = [];
    sections.forEach((chunk, ordinal) => {
      for (const raw of paragraphs(chunk.text).slice(0, 4)) {
        const para = dropLeadingMeta(raw);
        if (para) candidates.push({ section: chunk.section, para, sectionOrdinal: ordinal });
      }
    });
    const third = Math.max(1, Math.ceil(sections.length / 3));
    const buckets = [
      candidates.filter((c) => c.sectionOrdinal < third),
      candidates.filter((c) => c.sectionOrdinal >= third && c.sectionOrdinal < 2 * third),
      candidates.filter((c) => c.sectionOrdinal >= 2 * third),
    ];
    const picked: typeof candidates = [];
    for (let round = 0; picked.length < maxPassagesPerPage; round++) {
      let took = false;
      for (const bucket of buckets) {
        if (picked.length >= maxPassagesPerPage) break;
        const item = bucket[round];
        if (item) {
          picked.push(item);
          took = true;
        }
      }
      if (!took) break;
    }
    picked.sort((a, b) => a.sectionOrdinal - b.sectionOrdinal);
    let pIndex = 0;
    for (const c of picked) {
      passages.push({
        id: freshId('p'),
        docId: doc.id,
        // Wider window than a snippet: real cards carry several sentences of
        // the source so the knowledge is substantial, not spliced.
        text: clampAtSentence(c.para, 920, 1500),
        anchor: c.section,
        anchorUrl:
          c.section === 'Overview' ? url : `${url}#${encodeURIComponent(c.section.replace(/ /g, '_'))}`,
        index: pIndex++,
      });
    }
    if (picked.length > 0) docs.push(doc);
  }
  return { docs, passages };
}
