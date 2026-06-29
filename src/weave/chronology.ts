// Chronology: pull approximate dates out of verbatim passage text so topics that
// are inherently temporal -- a war, a life, an era -- can be laid on a timeline
// and connected in time. Plain regex over the text, deterministic, no model and
// NO mutation of passages (the verbatim invariant holds). A "year" is a signed
// integer: BC/BCE negative, AD/CE and plain years positive; a century maps to its
// midpoint. Years are clamped to a sane window so stray digits never pollute a span.

export interface DateHit {
  year: number; // signed: BCE negative
  raw: string; // the matched surface text (for display / debugging)
}

const MIN_YEAR = -4000; // earliest we trust from loose prose
const MAX_YEAR = 2100;

const RANGE = /\b(\d{3,4})\s*(?:–|—|-|to)\s*(\d{3,4})\b/g;
const BCE = /\b(\d{1,4})\s*(?:BC|BCE)\b/gi;
const CE = /\b(?:AD|CE)\s*(\d{1,4})\b|\b(\d{3,4})\s*(?:AD|CE)\b/gi;
const CENTURY = /\b(\d{1,2})(?:st|nd|rd|th)\s+centur(?:y|ies)\b(\s*(?:BC|BCE))?/gi;
// Plain years restricted to a plausible window so we don't grab arbitrary counts.
const PLAIN = /\b(?:1\d{3}|20\d{2})\b/g;

const inRange = (y: number) => y >= MIN_YEAR && y <= MAX_YEAR;
const centuryMid = (n: number, bce: boolean) => (bce ? -((n - 1) * 100 + 50) : (n - 1) * 100 + 50);

/**
 * Every date mentioned in the text, as signed years. Ranges contribute both
 * endpoints; centuries contribute their midpoint. Deduped, sorted ascending.
 */
export function extractDates(text: string): DateHit[] {
  const hits: DateHit[] = [];
  const push = (year: number, raw: string) => {
    if (inRange(year)) hits.push({ year, raw });
  };

  for (const m of text.matchAll(RANGE)) {
    push(Number(m[1]), m[0]);
    push(Number(m[2]), m[0]);
  }
  for (const m of text.matchAll(BCE)) push(-Number(m[1]), m[0]);
  for (const m of text.matchAll(CE)) push(Number(m[1] ?? m[2]), m[0]);
  for (const m of text.matchAll(CENTURY)) push(centuryMid(Number(m[1]), !!m[2]), m[0]);
  for (const m of text.matchAll(PLAIN)) push(Number(m[0]), m[0]);

  // Dedup by year (keep the first surface seen), then sort.
  const byYear = new Map<number, DateHit>();
  for (const h of hits) if (!byYear.has(h.year)) byYear.set(h.year, h);
  return [...byYear.values()].sort((a, b) => a.year - b.year);
}

/** A representative [start, end] span for a chunk of text, or null if undated. */
export function eraOf(text: string): { start: number; end: number } | null {
  const dates = extractDates(text);
  if (dates.length === 0) return null;
  return { start: dates[0].year, end: dates[dates.length - 1].year };
}

/** Merge spans into one enclosing span (min start, max end), or null if all null. */
export function mergeEras(
  spans: ({ start: number; end: number } | null)[],
): { start: number; end: number } | null {
  let start = Infinity;
  let end = -Infinity;
  for (const s of spans) {
    if (!s) continue;
    if (s.start < start) start = s.start;
    if (s.end > end) end = s.end;
  }
  return start === Infinity ? null : { start, end };
}

/**
 * Is this topic inherently chronological -- worth offering a timeline and time
 * connections? A person or event always is; otherwise, a topic qualifies when a
 * good fraction of its passages carry dates AND those dates actually span time.
 */
export function isChronological(opts: {
  qType?: string;
  datedFraction?: number;
  spanYears?: number;
}): boolean {
  if (opts.qType === 'person' || opts.qType === 'event') return true;
  return (opts.datedFraction ?? 0) >= 0.35 && (opts.spanYears ?? 0) >= 15;
}

/** A human label for a signed year ("1939", "44 BC", "1450s"). */
export function formatYear(year: number): string {
  if (year < 0) return `${-year} BC`;
  return String(year);
}
