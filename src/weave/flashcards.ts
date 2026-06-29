// Flashcards: active-recall cards built from the corpus's OWN grounding of a
// concept. The back is verbatim source material (the sentence that defines the
// term, or its reference definition) -- never invented -- so a flashcard is the
// hidden-answer companion to a definition card. Pure and deterministic.

import type { Concept, Passage, SourceDoc } from '../types';

export interface BuiltFlashcard {
  conceptId: string;
  label: string;
  front: string;
  back: string;
  source: { title: string; url: string };
}

/** First sentence of `text` mentioning `label`, card-sized; else the opening. */
function answerSentence(text: string, label: string): string {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const lc = label.toLowerCase();
  const hit =
    sentences.find((s) => s.toLowerCase().includes(lc) && s.length >= 30) ?? sentences[0] ?? text;
  return hit.trim().slice(0, 280);
}

/**
 * Build a recall flashcard for a concept: front = the concept cue, back = its
 * source-grounded answer (defining passage sentence, else reference definition,
 * else a sentence from its longest passage). Null when nothing grounds it.
 */
export function buildFlashcard(
  concept: Concept,
  passages: Passage[],
  docs: Map<string, SourceDoc>,
): BuiltFlashcard | null {
  const byId = (id: string) => passages.find((p) => p.id === id);
  let back = '';
  let source = { title: '', url: '' };

  const defP = concept.definedByPassage ? byId(concept.definedByPassage) : undefined;
  if (defP) {
    back = answerSentence(defP.text, concept.label);
    const d = docs.get(defP.docId);
    source = { title: d?.title ?? defP.docId, url: defP.anchorUrl ?? d?.url ?? '' };
  } else if (concept.definition) {
    back = concept.definition.text;
    source = { title: concept.definition.source, url: concept.definition.url };
  } else {
    const p = concept.passageIds
      .map(byId)
      .filter((x): x is Passage => !!x)
      .sort((a, b) => b.text.length - a.text.length)[0];
    if (p) {
      back = answerSentence(p.text, concept.label);
      const d = docs.get(p.docId);
      source = { title: d?.title ?? p.docId, url: p.anchorUrl ?? d?.url ?? '' };
    }
  }
  if (!back) return null;
  return {
    conceptId: concept.id,
    label: concept.label,
    front: `Recall: what is “${concept.label}”?`,
    back,
    source,
  };
}
