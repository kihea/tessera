// Mastery depth: sources are NOT one flat pool of snippets. Each passage gets
// a depth rung -- how much mastery it presupposes -- read off the source's own
// structure (section headings, source type, definitional density, position in
// the document). The loom then matches passages to the learner's current
// stage and nudges one rung ahead: the encyclopedia's "Criticism" section and
// the paper abstract WAIT until the foundations they presuppose are woven.
// This is the engine's Iceberg-layer ladder, re-derived from real documents.

import type { Concept, Passage, SourceDoc } from '../types';
import { hasContrastCue } from './connections';

export const DEPTH_LABEL = ['Foundation', 'Mechanism', 'In practice', 'Frontier'] as const;
export type DepthRung = 0 | 1 | 2 | 3;

/** What a source type presupposes by default, before section evidence. */
const TYPE_BASE: Record<SourceDoc['sourceType'], number> = {
  reference: 0,
  encyclopedia: 0.5,
  textbook: 1.1,
  news: 1.9, // period reporting = the topic in practice
  video: 0.9, // lectures/talks tend to explain accessibly
  discussion: 2.0,
  book: 2.1,
  primary: 2.4, // original documents presuppose their context
  paper: 2.8,
};

/** Section-heading cues, most demanding first. Section evidence outweighs type. */
const SECTION_DEPTH: [RegExp, number][] = [
  [/(criticism|controvers|limitation|reception|scholar|research|literature|debate|variant|advanced|open problem|future direction)/i, 3],
  [/(application|example|use[sd]? (in|for)|in practice|implementation|case stud|society|culture|impact|industr|economic)/i, 2],
  [/(method|mechanis|process|how |principle|structure|operation|technique|procedure|algorithm|component|steps|function)/i, 1.2],
  [/^(overview|introduction|definition|etymology|terminology|background)/i, 0],
];

export function depthRung(d: number): DepthRung {
  return Math.max(0, Math.min(3, Math.round(d))) as DepthRung;
}

export function annotateDepth(
  passages: Passage[],
  docs: Map<string, SourceDoc>,
  concepts: Concept[],
): void {
  const perDoc = new Map<string, number>();
  for (const p of passages) perDoc.set(p.docId, (perDoc.get(p.docId) ?? 0) + 1);

  for (const passage of passages) {
    const doc = docs.get(passage.docId);
    let d = doc ? TYPE_BASE[doc.sourceType] : 1;
    const anchor = passage.anchor ?? '';
    let sectionMatched = false;
    for (const [re, sectionDepth] of SECTION_DEPTH) {
      if (re.test(anchor)) {
        d = (d + 2 * sectionDepth) / 3; // the document's own structure dominates
        sectionMatched = true;
        break;
      }
    }
    // Position within a document only means something when the document
    // contributes several passages. A paper abstract or newspaper window is
    // index 0 by construction -- it is not a "lead" that orients, and pulling
    // it down would erase the Frontier rung from the whole corpus.
    if (!sectionMatched && (perDoc.get(passage.docId) ?? 1) > 1) {
      if (passage.index === 0) d -= 0.4; // leads orient
      else if (passage.index >= 4) d += 0.5; // deep-in-document presupposes more
    }
    if (concepts.some((c) => c.definedByPassage === passage.id)) d -= 0.6; // it grounds its own terms
    if (hasContrastCue(passage.text)) d += 0.35; // weighing views presupposes the views
    passage.depth = Math.max(0, Math.min(3, d));
  }
}
