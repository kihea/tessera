// Wiktionary definitions for emergent key terms. Used ONLY as a fallback:
// if a corpus passage already defines a term, the corpus wins -- the form is
// constructed from the material, not imported from outside it.

import { getJSON, stripHtml } from './net';

interface WiktionarySense {
  definition?: string;
}
interface WiktionaryEntry {
  partOfSpeech?: string;
  definitions?: WiktionarySense[];
}

export interface TermDefinition {
  text: string;
  url: string;
  source: string;
}

// Parts of speech that are never the topic sense -- a recurring TERM should not
// be "defined" by its use as a symbol, a code, or a proper name.
const REJECT_POS =
  /^(symbol|letter|numeral|number|proper noun|initialism|abbreviation|acronym|romanization|han character|prefix|suffix|particle|article|punctuation)/i;
// Senses that are clearly off-topic codes/symbols, e.g. the ISO-639-3 "code for"
// gloss that the bare word "low" picks up.
const REJECT_SENSE =
  /\b(ISO\b|language code|alphabet|symbol for|abbreviation|initialism|acronym|given name|surname|\bcode for\b|chemical (element|symbol)|SI unit|romaniz|diacritic)\b/i;
// Real meaning carriers, best first.
const POS_RANK = ['noun', 'verb', 'adjective', 'adverb'];

// A word like "spectral" carries several senses ("ghostly" vs "of a
// spectrum"); inside a Fourier corpus only one of them is the topic's sense.
// Senses marked as archaic/figurative lose to living, technical ones.
const DATED_SENSE = /\b(archaic|obsolete|poetic|dated|literary|figurative|ghostly|spectres?|specters?)\b/i;

/**
 * Define a term IN CONTEXT: every candidate sense is scored by the corpus
 * words it shares, WEIGHTED by how central each word is to the corpus (its
 * concept's document frequency). The weighting is what breaks ties right:
 * in an AI corpus, "machine -> a computer" (matching the top concept
 * "computer") must beat "machine -> a vehicle" (matching one word of the
 * niche concept "autonomous vehicles"). Without context, the first sense of
 * the best part of speech wins, as before.
 */
export async function defineTerm(
  term: string,
  contextWords?: Map<string, number>,
): Promise<TermDefinition | null> {
  const slug = term.trim().replace(/ /g, '_').toLowerCase();
  const data = (await getJSON(
    `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(slug)}`,
    6000,
  )) as Record<string, WiktionaryEntry[]> | null;
  const entries = data?.en;
  if (!entries || entries.length === 0) return null;

  const usable = entries.filter((e) => !REJECT_POS.test(e.partOfSpeech ?? ''));
  usable.sort((a, b) => {
    const ra = POS_RANK.indexOf((a.partOfSpeech ?? '').toLowerCase());
    const rb = POS_RANK.indexOf((b.partOfSpeech ?? '').toLowerCase());
    return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb);
  });

  const candidates: { text: string; pos: string }[] = [];
  for (const entry of usable) {
    for (const sense of entry.definitions ?? []) {
      const text = sense.definition ? stripHtml(sense.definition) : '';
      if (text.length < 12) continue;
      if (/^(plural|alternative (form|spelling)|obsolete|misspelling|initialism|acronym)/i.test(text)) continue;
      // "form-of" glosses carry no meaning ("third-person singular simple
      // present indicative of function"). Their shape: they END at "of <lemma>"
      // -- which spares real definitions like "in the form of movement".
      if (/\b(singular|plural|tense|participle|inflection|indicative|spelling|form)\s+of\s+[a-z'’-]+\s*\.?$/i.test(text))
        continue;
      if (REJECT_SENSE.test(text)) continue;
      candidates.push({ text, pos: (entry.partOfSpeech ?? '').toLowerCase() });
    }
  }
  if (candidates.length === 0) return null;

  // Candidates arrive POS-ranked; scoring only OVERRIDES that order when the
  // corpus genuinely speaks for a sense (strict >, so ties keep the default).
  // A sense that merely repeats the headword ("to have a function") proves
  // nothing about domain fit, so the term's own words never count.
  const selfWords = new Set(
    term
      .toLowerCase()
      .split(/[\s_-]+/)
      .flatMap((w) => [w, w.replace(/(?:es|s)$/, '')]),
  );
  let best = candidates[0];
  if (contextWords && contextWords.size > 0 && candidates.length > 1) {
    let bestScore = -Infinity;
    for (const c of candidates) {
      let score = 0;
      const senseWords = new Set(c.text.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []);
      for (const w of senseWords) {
        const stem = w.replace(/(?:es|s)$/, '');
        if (selfWords.has(w) || selfWords.has(stem)) continue;
        score += Math.max(contextWords.get(w) ?? 0, contextWords.get(stem) ?? 0);
      }
      if (DATED_SENSE.test(c.text)) score -= 2.5;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    // A heavily polysemous everyday word where NO sense speaks the corpus's
    // language ("field" as farmland/sports/battle in an AI corpus): a card
    // showing its everyday sense teaches nothing -- show no card at all.
    if (bestScore <= 0 && candidates.length >= 4) return null;
  }

  const pos = best.pos ? `(${best.pos}) ` : '';
  return {
    text: `${pos}${best.text}`,
    url: `https://en.wiktionary.org/wiki/${encodeURIComponent(slug)}`,
    source: 'Wiktionary',
  };
}
