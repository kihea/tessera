// Coarse language detection so the corpus stays in ONE language. The bulk of
// the material (Wikipedia/Wikibooks/HN, all English hosts) sets the language;
// Crossref in particular returns abstracts in other languages for the same
// query, and a German abstract dropped into an English weave is noise. We keep
// only passages whose language matches the dominant one. Keyless and
// inspectable: a non-Latin script is detected by its Unicode block, and Latin
// scripts are told apart by their function-word fingerprint.

import type { Passage } from '../types';

// High-frequency function words per language. English is distinguished from its
// Latin-script neighbours by which of these dominate.
const FUNC: Record<string, Set<string>> = {
  en: new Set(
    'the of and to in is are was were for that with as it on by an be this from or at which not but have has had will would can could a he she they we you'.split(
      ' ',
    ),
  ),
  es: new Set('el la los las de que y a en un una por con para se su lo como más pero del al es son'.split(' ')),
  de: new Set('der die das und zu den von mit sich des auf für ist im dem nicht ein eine als auch werden'.split(' ')),
  fr: new Set('le la les des et de un une que qui dans pour pas sur par plus avec ce est sont au aux'.split(' ')),
  pt: new Set('o a os as de que e do da em um uma por com para se na no mais como mas dos é são'.split(' ')),
  it: new Set('il la le di che e un una per con non si come più ma dei della nel sono è gli lo'.split(' ')),
};

function scriptOf(text: string): string | null {
  if (/[一-鿿぀-ヿ가-힯]/.test(text)) return 'cjk';
  if (/[Ѐ-ӿ]/.test(text)) return 'cyrillic';
  if (/[؀-ۿ]/.test(text)) return 'arabic';
  if (/[֐-׿]/.test(text)) return 'hebrew';
  if (/[ऀ-ॿ]/.test(text)) return 'devanagari';
  if (/[Ͱ-Ͽ]/.test(text)) return 'greek';
  return null;
}

/** A coarse language tag: a script name, a Latin language code, or 'unknown'. */
export function langOf(text: string): string {
  const script = scriptOf(text);
  if (script) return script;
  const tokens = text.toLowerCase().match(/[a-zà-öø-ÿ]+/g) ?? [];
  if (tokens.length < 8) return 'unknown'; // too short to judge -- never dropped
  const sample = tokens.slice(0, 120);
  let best = 'unknown';
  let bestScore = 0;
  for (const [lang, set] of Object.entries(FUNC)) {
    let hits = 0;
    for (const t of sample) if (set.has(t)) hits++;
    const score = hits / sample.length;
    if (score > bestScore) {
      bestScore = score;
      best = lang;
    }
  }
  return bestScore >= 0.04 ? best : 'unknown';
}

/**
 * Keep only passages whose language matches the dominant one. 'unknown' (short
 * excerpts, opening lines) is always kept -- we only drop a passage we are
 * confident is in a different language from the body of the material.
 */
export function filterToDominantLanguage(passages: Passage[]): Passage[] {
  const counts = new Map<string, number>();
  const lang = new Map<string, string>();
  for (const p of passages) {
    const l = langOf(p.text);
    lang.set(p.id, l);
    if (l !== 'unknown') counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  let dominant: string | null = null;
  let max = 0;
  for (const [l, n] of counts) {
    if (n > max) {
      max = n;
      dominant = l;
    }
  }
  if (!dominant) return passages;
  return passages.filter((p) => {
    const l = lang.get(p.id);
    return l === 'unknown' || l === dominant;
  });
}
