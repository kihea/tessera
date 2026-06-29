import { getJSON } from './net';

// Pre-feed disambiguation. A polysemous query ("firewall" = computing / construction /
// physics / the Great Firewall / a video game) otherwise gets researched as a MIX of
// senses, or latches onto whichever one a provider ranked first -- so the learner asked
// to pick the sense BEFORE the feed is built. We read the candidate senses from
// Wikipedia's search (it surfaces "Title (qualifier)" pages + disambiguation pages) and
// only interrupt when the query is genuinely ambiguous; otherwise research proceeds.

export interface Sense {
  title: string; // the Wikipedia title, e.g. "Firewall (computing)"
  blurb: string; // a short snippet describing the sense
  query: string; // the refined query to research THIS sense, e.g. "Firewall computing"
}

const clean = (s: string): string =>
  (s ?? '').replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();

const deQualify = (t: string): string => t.toLowerCase().replace(/\s*\(.+?\)\s*$/, '').trim();

/**
 * Return the candidate senses for an ambiguous query, or `[]` when the query is
 * unambiguous (research should just proceed). Fail-open: any network/parse problem
 * returns `[]`.
 */
export async function fetchSenses(query: string): Promise<Sense[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const term = q.toLowerCase().replace(/\s+/g, ' ');
  try {
    const api = 'https://en.wikipedia.org/w/api.php';
    const data = (await getJSON(
      `${api}?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=12&srprop=snippet&format=json&origin=*`,
    )) as { query?: { search?: { title: string; snippet?: string }[] } } | null;
    const hits = data?.query?.search ?? [];
    if (hits.length < 2) return [];

    const senses: Sense[] = [];
    const seen = new Set<string>();
    let sawDisambiguationPage = false;
    for (const h of hits) {
      const snip = clean(h.snippet ?? '');
      if (/\bmay refer to\b|\bdisambiguation\b/i.test(snip)) {
        sawDisambiguationPage = true;
        continue; // the disambiguation page itself isn't a sense
      }
      const base = deQualify(h.title);
      const related =
        base === term || base.includes(term) || term.includes(base) || h.title.toLowerCase().includes(term);
      if (!related) continue;
      const key = h.title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      // Research the EXACT page title so the foundation anchors on this precise sense
      // (Wikipedia matches the title exactly) instead of a fuzzy keyword search that
      // re-mixes the senses.
      senses.push({ title: h.title, blurb: snip.slice(0, 150), query: h.title });
    }

    // Ambiguous when several senses carry distinct qualifiers, or a disambiguation page
    // sits alongside ≥2 candidate senses. Otherwise treat as unambiguous.
    const qualified = senses.filter((s) => /\(.+?\)/.test(s.title));
    const ambiguous = qualified.length >= 2 || (sawDisambiguationPage && senses.length >= 2);
    return ambiguous ? senses.slice(0, 6) : [];
  } catch {
    return [];
  }
}
