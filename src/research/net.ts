// Small shared helpers for the research providers. Everything is best-effort:
// a provider that times out or errors simply contributes nothing.

export async function getJSON(url: string, timeoutMs = 9000): Promise<unknown | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const inTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * Like getJSON, but on the desktop app it routes through the Rust core (no
 * browser same-origin policy), so keyed providers whose APIs don't send CORS
 * headers (The Guardian, GNews) still work there. In the pure-web build it
 * falls back to a direct fetch -- best-effort, so a CORS-blocked provider just
 * contributes nothing rather than erroring.
 */
export async function getJSONProxied(url: string, timeoutMs = 12000): Promise<unknown | null> {
  if (inTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const text = await invoke<string>('http_get', { url, timeoutMs });
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  }
  return getJSON(url, timeoutMs);
}

/** Strip HTML tags and decode the handful of entities these APIs emit. */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

let idCounter = 0;
export function freshId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

/**
 * Raw URLs that leak into source text (HN comments especially). They are never
 * topic vocabulary -- "https www" must not become a concept -- and they read
 * terribly inside an excerpt, so every consumer either strips them (term
 * statistics), skips them (checks), or renders them as a short link element
 * (cards, notes). Trailing punctuation belongs to the prose, not the URL.
 */
const URL_PATTERN = "(?:https?:\\/\\/|www\\.)[^\\s<>\"'）)\\]]+";

export function urlRegex(): RegExp {
  return new RegExp(URL_PATTERN, 'gi');
}

/** Split a raw match into the usable href and the trailing prose punctuation. */
export function splitUrlMatch(match: string): { href: string; trail: string } {
  const trail = match.match(/[.,;:!?…]+$/)?.[0] ?? '';
  const raw = match.slice(0, match.length - trail.length);
  return { href: raw.startsWith('http') ? raw : `https://${raw}`, trail };
}

export function hasUrl(text: string): boolean {
  return urlRegex().test(text);
}

/** Remove raw URLs entirely (concept extraction must never see them). */
export function stripUrls(text: string): string {
  return text.replace(urlRegex(), ' ');
}

/** Replace raw URLs with markdown [link](url) -- for notebook clips. */
export function urlsToMarkdownLinks(text: string): string {
  return text.replace(urlRegex(), (m) => {
    const { href, trail } = splitUrlMatch(m);
    return `[link](${href})${trail}`;
  });
}

/** Meaningful lowercase tokens of a query, for relevance checks. */
export function queryTokens(query: string): string[] {
  return [
    ...new Set(
      (query.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? []).filter(
        (w) => !/^(the|and|how|why|what|with|from|into|does|that|this|their|about|between|history)$/.test(w),
      ),
    ),
  ];
}

/**
 * Is an excerpt genuinely ABOUT the query, not a passing mention? Either two
 * different query terms appear, or one term recurs -- a page actually on the
 * telegraph says "telegraph" more than once.
 */
export function relevanceOk(text: string, tokens: string[]): boolean {
  const lower = text.toLowerCase();
  let distinct = 0;
  let repeated = false;
  for (const t of tokens) {
    let count = 0;
    let i = lower.indexOf(t);
    while (i >= 0 && count < 2) {
      count++;
      i = lower.indexOf(t, i + t.length);
    }
    if (count > 0) distinct++;
    if (count >= 2) repeated = true;
  }
  return distinct >= 2 || repeated;
}

/** Normalize OCR text: join hyphenated line breaks, collapse whitespace. */
export function cleanOcr(text: string): string {
  return text
    .replace(/(\w)-\s*\n\s*(\w)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Is this OCR text clean enough to read as a verbatim excerpt? Historic scans
 * vary wildly; garbage passages would poison concept extraction and checks.
 */
export function ocrQualityOk(text: string): boolean {
  if (text.length < 200) return false;
  const letters = (text.match(/[a-zA-Z\s,.;:'"()-]/g) ?? []).length / text.length;
  if (letters < 0.88) return false;
  const words = text.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
  if (words.length < 30) return false;
  const withVowels = words.filter((w) => /[aeiouyAEIOUY]/.test(w)).length / words.length;
  if (withVowels < 0.88) return false;
  const avgLen = words.reduce((s, w) => s + w.length, 0) / words.length;
  return avgLen >= 3.2 && avgLen <= 9;
}

/**
 * Read only the head of a large text file (e.g. an Internet Archive book) via
 * a streamed fetch, cancelling once enough has arrived. Plain GET -- no Range
 * header, so no CORS preflight.
 */
export async function fetchTextHead(url: string, maxChars = 220000, timeoutMs = 12000): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let out = '';
    while (out.length < maxChars) {
      const { done, value } = await reader.read();
      if (done) break;
      out += decoder.decode(value, { stream: true });
    }
    void reader.cancel().catch(() => {});
    return out;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Split text into sentences (rough, good enough for trimming). */
export function sentences(text: string): string[] {
  return text.match(/[^.!?]+(?:[.!?]+["')\]]?|\s*$)/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
}

const META_VERB =
  /\b(delves?|examin\w*|explor\w*|discuss\w*|introduc\w*|present\w*|describ\w*|focus\w*|review\w*|consider\w*|address\w*|investigat\w*|analy[sz]\w*|outlin\w*|summari[sz]\w*|cover\w*|deal\w*\s+with|aim\w*\s+to|seek\w*\s+to|attempt\w*\s+to|look\w*\s+at)\b/i;

/**
 * Does this sentence describe the DOCUMENT rather than the subject? e.g.
 * "Chapter 2 delves into the historical development of inflation." Those read
 * as table-of-contents prose, not content -- the cards should carry the actual
 * material, so we trim these away (we drop, never rewrite).
 */
export function isMetaSentence(s: string): boolean {
  const h = s.trim();
  if (/^chapter\s+\d+/i.test(h)) return true;
  if (/^(?:sub)?section\s+\d+/i.test(h)) return true;
  if (/^part\s+(?:\d+|one|two|three|i{1,3}v?)\b/i.test(h)) return true;
  if (/^(?:in\s+)?this\s+(paper|chapter|section|article|study|book|essay|work|review|entry)\b/i.test(h) && META_VERB.test(h))
    return true;
  if (/^the\s+(present|current|following|next)\s+(paper|chapter|section|study|work|article)\b/i.test(h)) return true;
  if (/^here\s+we\s+(present|propose|describe|review|introduce|report|show)\b/i.test(h)) return true;
  if (/\bmay refer to\b/i.test(h)) return true;
  if (/^this\s+(article|page|disambiguation)\s+is\s+about\b/i.test(h)) return true;
  return false;
}

/**
 * Strip leading document-describing sentences. If little substance remains the
 * passage is essentially a summary-of-a-summary -- return '' so it is dropped.
 */
export function dropLeadingMeta(text: string, minKeep = 200): string {
  const parts = sentences(text);
  let i = 0;
  while (i < parts.length && isMetaSentence(parts[i])) i++;
  if (i === 0) return text;
  const kept = parts.slice(i).join(' ').trim();
  return kept.length >= minKeep ? kept : '';
}

/**
 * Cut an over-long verbatim run at a sentence boundary near `target` chars.
 * We trim, we never rewrite -- the result is still a contiguous quote.
 */
export function clampAtSentence(text: string, target = 700, max = 1100): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  let cut = -1;
  const re = /[.!?]["')\]]?\s/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(slice)) !== null) {
    if (m.index >= target * 0.55) {
      cut = m.index + 1;
      if (m.index >= target) break;
    }
  }
  return cut > 0 ? slice.slice(0, cut).trim() : slice.trim() + '…';
}
