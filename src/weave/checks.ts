// Checks for understanding: tiny recall tests drawn from the ACTUAL content of
// a passage the learner already saw -- never invented facts. A check takes one
// real sentence, blanks out a meaningful thread, and asks the learner to supply
// it (typed, or chosen from look-alike threads). Getting it right is the
// retention signal the bandit learns from, attributed to the SOURCE TYPE the
// sentence came from -- so the app learns which materials the learner actually
// remembers, per type, independently.

import type { CheckFormat, Concept, Passage } from '../types';
import { hasUrl, sentences } from '../research/net';

export interface BuiltCheck {
  format: CheckFormat;
  instruction: string;
  blanked: string;
  answer: string;
  accept: string[];
  options?: string[];
  conceptId: string;
  conceptLabel: string;
}

export const BLANK_TOKEN = '█████'; // reads as a blank to fill

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** First occurrence of a concept (allowing a simple plural) in `text`. */
function findSurface(text: string, label: string): { index: number; length: number } | null {
  const re = new RegExp(`\\b${escapeRe(label)}(?:s|es)?\\b`, 'i');
  const m = re.exec(text);
  return m ? { index: m.index, length: m[0].length } : null;
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ').replace(/s$/, '');
}

/**
 * Does this chrome copy give the answer away? True when any word of the
 * answer label appears in the text (e.g. answer "memory" with copy "...from
 * memory?", or "thread" inside "the missing thread").
 */
export function mentionsAnswer(text: string, label: string): boolean {
  const lower = text.toLowerCase();
  return label
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .some((w) => new RegExp(`\\b${escapeRe(w.replace(/s$/, ''))}`, 'i').test(lower));
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Does concept `b` share a word with `a`? (avoid a distractor that's a near-synonym) */
function sharesWord(a: Concept, b: Concept): boolean {
  const wa = new Set(a.id.split(' '));
  return b.id.split(' ').some((w) => wa.has(w));
}

/**
 * Build a check from a passage. `seen` is the set of concept ids already
 * surfaced (we only test things the learner has met); `used` avoids re-testing
 * the same concept. Returns null when nothing suitable can be drawn.
 */
export function buildCheck(
  passage: Passage,
  concepts: Concept[],
  exposure: Map<string, number>,
  used: Set<string>,
  preferCloze = false,
): BuiltCheck | null {
  const here = concepts.filter(
    (c) =>
      c.important &&
      c.passageIds.includes(passage.id) &&
      (exposure.get(c.id) ?? 0) >= 2 &&
      !used.has(c.id) &&
      findSurface(passage.text, c.label),
  );
  here.sort((a, b) => b.weight - a.weight);
  if (here.length === 0) return null;

  const answer = here[0];
  // Choose the sentence that contains the term and reads as a self-contained
  // statement (not too short, not a whole paragraph).
  const candidates = sentences(passage.text)
    .map((s) => ({ s: s.trim(), hit: findSurface(s, answer.label) }))
    // A sentence carrying a raw URL makes a messy quiz card -- skip it.
    .filter((x): x is { s: string; hit: { index: number; length: number } } => !!x.hit && !hasUrl(x.s));
  if (candidates.length === 0) return null;
  const sized = candidates.filter((c) => c.s.length >= 40 && c.s.length <= 280);
  const chosen = (sized.length ? sized : candidates).sort((a, b) => a.s.length - b.s.length)[0];

  let sentence = chosen.s;
  let hit = chosen.hit;
  // If the only sentence is long, window it around the blank so the card is tight.
  if (sentence.length > 280) {
    const start = Math.max(0, hit.index - 120);
    const end = Math.min(sentence.length, hit.index + hit.length + 120);
    const sliced = sentence.slice(start, end);
    const reHit = findSurface(sliced, answer.label);
    if (reHit) {
      sentence = (start > 0 ? '…' : '') + sliced + (end < chosen.s.length ? '…' : '');
      hit = { index: reHit.index + (start > 0 ? 1 : 0), length: reHit.length };
    }
  }

  const blanked = sentence.slice(0, hit.index) + BLANK_TOKEN + sentence.slice(hit.index + hit.length);
  const removed = sentence.slice(hit.index, hit.index + hit.length);
  const accept = [...new Set([norm(answer.label), norm(removed)])];

  // Distractors: other meaningful threads NOT in this passage, preferring ones
  // the learner has already met (plausible look-alikes), excluding near-synonyms.
  const pool = concepts.filter(
    (c) =>
      c.id !== answer.id &&
      c.important &&
      !c.passageIds.includes(passage.id) &&
      !sharesWord(answer, c) &&
      c.label.length <= answer.label.length + 14,
  );
  pool.sort((a, b) => (exposure.get(b.id) ?? 0) - (exposure.get(a.id) ?? 0));
  const distractors = shuffle(pool.slice(0, 6)).slice(0, 3);

  // Instruction copy must never echo the answer (a corpus where "memory" or
  // "term" is itself a concept would otherwise leak it).
  const pick = (variants: string[]) =>
    variants.find((v) => !mentionsAnswer(v, answer.label)) ?? 'Fill the blank.';

  // Alternate recall (cloze) with recognition (mcq) for variety; cloze is the
  // harder, stronger retention test, so we lean on it when asked.
  if (!preferCloze && distractors.length >= 2) {
    const options = shuffle([answer.label, ...distractors.map((d) => d.label)]);
    return {
      format: 'mcq',
      instruction: pick([
        'From what you read, which thread fills the blank?',
        'Which of these belongs in the blank?',
        'Pick what the source actually said.',
      ]),
      blanked,
      answer: answer.label,
      accept,
      options,
      conceptId: answer.id,
      conceptLabel: answer.label,
    };
  }

  return {
    format: 'cloze',
    instruction: pick([
      'From memory, what fills the blank?',
      'What goes in the blank? No peeking.',
      'Recall what the source said here.',
    ]),
    blanked,
    answer: answer.label,
    accept,
    conceptId: answer.id,
    conceptLabel: answer.label,
  };
}

/** Normalize a typed cloze answer for comparison. */
export function clozeMatches(input: string, accept: string[]): boolean {
  const v = norm(input);
  return v.length > 0 && accept.includes(v);
}
