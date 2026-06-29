// The weave itself: passage-to-passage connections carried by shared
// concepts. A connection's `via` terms are the learning objectives -- what
// you are meant to take from card A into card B. Thread kinds are detected
// from the text's own rhetorical cues, never invented.

import type { Concept, Connection, Passage, SourceDoc, ThreadKind } from '../types';
import { isGenericTerm } from './terms';

const CONTRAST_CUES =
  /\b(however|whereas|unlike|in contrast|on the other hand|but this|critics?|criticism|disagree|misleading|overstated|myth|not actually|contrary to|despite)\b/i;
const APPLY_CUES =
  /\b(for example|for instance|such as|in practice|applied to|application|used to|use case|real[- ]world|e\.g\.)\b/i;

/** Does this text weigh views against each other? (also used for depth) */
export function hasContrastCue(text: string): boolean {
  return CONTRAST_CUES.test(text);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Does this passage DEFINE the concept (rather than merely use it)? The shape
 * of a real definition sentence: the term sits at the head of a sentence --
 * allowing the "In mathematics, the ..." framing and one parenthetical or
 * appositive -- and is immediately followed by a copula or defining verb.
 * A loose any-60-chars gap matched "In the 19th century, the telegraph was
 * invented" and crowned "century" a defined term; this anchored form does not.
 */
export function definesConcept(passage: Passage, concept: Concept): boolean {
  const head = passage.text.slice(0, 320);
  const pattern = new RegExp(
    `(?:^|[.!?]["')\\]]?\\s+)` + // a sentence begins
      `(?:in\\s[^,.;:]{0,40},\\s*)?` + // optional domain frame: "In mathematics, "
      `(?:the\\s+|an?\\s+)?${escapeRe(concept.label)}(?:s|es)?\\b` + // the term itself
      `\\s*(?:\\([^)]{0,90}\\))?` + // optional "(FT)" parenthetical
      `\\s*(?:,[^,]{0,70},)?` + // optional ", also called X,"
      `\\s*(?:is|are|was|were|refers? to|means|denotes|describes|consists of)\\b`,
    'i',
  );
  return pattern.test(head);
}

/** Pre-compute which corpus passage (if any) defines each concept. */
export function annotateDefinitions(passages: Passage[], concepts: Concept[]): void {
  for (const concept of concepts) {
    // Generic filler ("century", "finite") can match a define-shaped sentence
    // by accident; it must never be promoted into a quizzable, weavable thread.
    if (isGenericTerm(concept.id)) continue;
    for (const pid of concept.passageIds) {
      const passage = passages.find((p) => p.id === pid);
      if (passage && definesConcept(passage, concept)) {
        concept.definedByPassage = passage.id;
        concept.important = true; // a term a source bothers to define is a real thread
        break;
      }
    }
  }
}

export function buildConnections(passages: Passage[], concepts: Concept[]): Map<string, Connection[]> {
  const conceptsByPassage = new Map<string, Concept[]>();
  for (const concept of concepts) {
    for (const pid of concept.passageIds) {
      const list = conceptsByPassage.get(pid) ?? [];
      list.push(concept);
      conceptsByPassage.set(pid, list);
    }
  }

  const all: Connection[] = [];
  for (let i = 0; i < passages.length; i++) {
    for (let j = i + 1; j < passages.length; j++) {
      const a = passages[i];
      const b = passages[j];
      if (a.docId === b.docId && Math.abs(a.index - b.index) <= 1) continue; // adjacency is not insight
      const ca = conceptsByPassage.get(a.id) ?? [];
      const cb = new Set((conceptsByPassage.get(b.id) ?? []).map((c) => c.id));
      const shared = ca.filter((c) => cb.has(c.id));
      if (shared.length === 0) continue;
      const strength = shared.reduce((sum, c) => sum + c.weight, 0);
      if (strength < 0.8) continue;
      all.push({
        a: a.id,
        b: b.id,
        via: shared.sort((x, y) => y.weight - x.weight).map((c) => c.id),
        strength,
      });
    }
  }

  const byPassage = new Map<string, Connection[]>();
  const add = (pid: string, conn: Connection) => {
    const list = byPassage.get(pid) ?? [];
    list.push(conn);
    byPassage.set(pid, list);
  };
  for (const conn of all) {
    add(conn.a, conn);
    add(conn.b, conn);
  }
  for (const [pid, list] of byPassage) {
    list.sort((x, y) => y.strength - x.strength);
    byPassage.set(pid, list.slice(0, 8));
  }
  return byPassage;
}

/** Classify the thread from an earlier card to this new passage. */
export function threadKind(
  newPassage: Passage,
  newDoc: SourceDoc,
  sharedConcepts: Concept[],
): ThreadKind {
  if (sharedConcepts.some((c) => c.definedByPassage === newPassage.id)) return 'defines';
  if (CONTRAST_CUES.test(newPassage.text)) return 'contrasts';
  if (newDoc.sourceType === 'discussion') return 'questions';
  if (APPLY_CUES.test(newPassage.text)) return 'applies';
  return 'extends';
}
