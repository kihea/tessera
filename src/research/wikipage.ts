// Wikipedia page harvester: the rendered HTML of an article carries two things
// the plain-text extract loses.
//
// 1. REFERENCES. The works an article itself cites (arXiv preprints, DOI'd
//    papers, books) are the canonical reading list for the topic -- "Attention
//    Is All You Need" should be IN an AI source list, and it is sitting right
//    there in the reference markup. We harvest the <cite class="citation">
//    elements and hand them to OpenAlex to resolve into real abstracts. The
//    reference SECTION itself stays excluded from passages (wiki.ts skips it),
//    so citation clutter never reads as source prose.
//
// 2. FORMULAS. Math renders as an <img> whose src is a hotlinkable SVG of the
//    exact TeX in its alt attribute; named equations sit inside
//    <div class="equation-box"> with the equation's name as the box label.
//    For mathematical topics the formula IS the material -- prose about the
//    Fourier transform without the integral is a summary, not a source.

import type { Formula } from '../types';
import { freshId, getJSON } from './net';
import type { CitationRef } from './openalex';

export interface WikiHarvest {
  citations: CitationRef[];
  formulas: Formula[];
}

const SKIP_SECTION_RE =
  /references|external links|see also|further reading|notes|footnotes|bibliography|sources|citations|works cited/i;

function pageUrl(title: string): string {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

/** Strip surrounding quote marks a CS1 citation puts around article titles. */
function unquote(s: string): string {
  return s.replace(/^["“”'‘’\s]+|["“”'‘’\s]+$/g, '').trim();
}

function harvestCitations(root: Document): CitationRef[] {
  const refs: CitationRef[] = [];
  const seen = new Set<string>();
  for (const cite of root.querySelectorAll('cite')) {
    if (!/\bcitation\b/.test(cite.className)) continue;
    const ref: CitationRef = {};

    for (const a of cite.querySelectorAll('a')) {
      const href = a.getAttribute('href') ?? '';
      const arxiv = href.match(/arxiv\.org\/abs\/([^"#?\s]+)/i);
      if (arxiv && !ref.arxivId) ref.arxivId = decodeURIComponent(arxiv[1]);
      const doi = href.match(/doi\.org\/(10\.[^"#?\s]+)/i);
      if (doi && !ref.doi) ref.doi = decodeURIComponent(doi[1]).replace(/[.,;]+$/, '');
      // CS1 marks the work's title as an external text link.
      if (!ref.title && /\bexternal\b/.test(a.className)) {
        const t = unquote(a.textContent ?? '');
        if (t.length >= 12 && !/^https?:\/\//i.test(t)) ref.title = t;
      }
      // A famous-enough work's title links to its own Wikipedia article
      // instead ("Attention Is All You Need"). CS1 still wraps it in literal
      // quotes, which distinguishes the title link from author links.
      if (!ref.title && href.startsWith('/wiki/')) {
        const before = a.previousSibling;
        const quoted =
          before?.nodeType === Node.TEXT_NODE && /["“]\s*$/.test(before.textContent ?? '');
        if (quoted) {
          const t = unquote(a.textContent ?? '');
          if (t.length >= 12) ref.title = t;
        }
      }
    }
    // Books and journal articles without a linked title keep it in <i>.
    if (!ref.title) {
      const i = cite.querySelector('i');
      const t = unquote(i?.textContent ?? '');
      if (t.length >= 12) ref.title = t;
    }

    const text = cite.textContent ?? '';
    ref.year = text.match(/\((\d{4})\)/)?.[1];
    const authorBit = text.split('(')[0]?.split(';')[0]?.trim();
    if (authorBit && authorBit.length <= 60 && /^[A-Z]/.test(authorBit)) {
      ref.author = authorBit.replace(/[,.]+$/, '');
    }

    if (!ref.doi && !ref.arxivId && !ref.title) continue;
    const key = (ref.doi ?? ref.arxivId ?? ref.title ?? '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(ref);
  }
  // Identifier-bearing references resolve cheapest and are almost always the
  // scholarly ones; arXiv-titled next (resolved by verified title lookup).
  refs.sort((a, b) => Number(!!b.doi) - Number(!!a.doi) || Number(!!b.arxivId) - Number(!!a.arxivId));
  return refs.slice(0, 40);
}

function harvestFormulas(root: Document, title: string, maxFormulas = 6): Formula[] {
  const url = pageUrl(title);
  const out: Formula[] = [];
  const seen = new Set<string>();
  let section = '';
  let sectionAnchor = '';
  let lastProse = '';

  // One walk in document order: headings set the section, paragraphs set the
  // introducing prose, and each display equation is read with both in hand.
  for (const el of root.querySelectorAll('h2, h3, p, span.mwe-math-element')) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'h2' || tag === 'h3') {
      sectionAnchor = el.id || '';
      section = (sectionAnchor ? sectionAnchor.replace(/_/g, ' ') : el.textContent ?? '')
        .replace(/\[edit\]\s*$/i, '')
        .trim();
      continue;
    }
    if (tag === 'p') {
      const t = (el.textContent ?? '').trim();
      if (t.length >= 40) lastProse = t;
      continue;
    }
    // A math element. Only display equations make cards -- inline f(x)
    // mentions are typography, not material.
    if (SKIP_SECTION_RE.test(section)) continue;
    const inBox = el.closest('div.equation-box');
    const isDisplay = !/mwe-math-element-inline/.test(el.className) || !!inBox;
    if (!isDisplay) continue;
    const img = el.querySelector('img');
    const src = img?.getAttribute('src') ?? '';
    const latex = (img?.getAttribute('alt') ?? '').trim();
    if (!src.startsWith('https://') || latex.length < 24) continue;
    if (seen.has(src)) continue;
    seen.add(src);

    // The equation-box label is the source's own name for the formula.
    let caption: string | undefined;
    if (inBox) {
      for (const node of inBox.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          const t = (node.textContent ?? '').trim();
          if (t.length >= 3) {
            caption = t;
            break;
          }
        }
      }
    }

    out.push({
      id: freshId('f'),
      latex,
      svgUrl: src,
      caption,
      section: section || undefined,
      context: lastProse ? lastProse.slice(0, 300) : undefined,
      sourceTitle: title,
      url: sectionAnchor ? `${url}#${sectionAnchor}` : url,
      conceptIds: [],
    });
  }

  // Named equations first; then document order (foundational math comes early).
  out.sort((a, b) => Number(!!b.caption) - Number(!!a.caption));
  return out.slice(0, maxFormulas);
}

async function harvestPage(title: string): Promise<WikiHarvest> {
  const data = (await getJSON(
    `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}` +
      `&prop=text&format=json&formatversion=2&redirects=1&origin=*`,
    15000,
  )) as { parse?: { title?: string; text?: string } } | null;
  const html = data?.parse?.text;
  if (!html) return { citations: [], formulas: [] };
  const resolvedTitle = data?.parse?.title ?? title;
  const root = new DOMParser().parseFromString(html, 'text/html');
  return {
    citations: harvestCitations(root),
    formulas: harvestFormulas(root, resolvedTitle),
  };
}

/** Harvest the top pages of a wiki search; merged, citations deduped. */
export async function harvestWikiPages(titles: string[], maxPages = 2): Promise<WikiHarvest> {
  const results = await Promise.all(titles.slice(0, maxPages).map((t) => harvestPage(t)));
  const citations: CitationRef[] = [];
  const formulas: Formula[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    for (const c of r.citations) {
      const key = (c.doi ?? c.arxivId ?? c.title ?? '').toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      citations.push(c);
    }
    formulas.push(...r.formulas);
  }
  return { citations, formulas: formulas.slice(0, 10) };
}
