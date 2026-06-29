// Dimensional classification (the user's framework). A concept's dimension is
// read SEMANTICALLY -- from its embedding's similarity to a baked exemplar of each
// dimension -- NOT from its surface word, because a word is itself a 5th-dimensional
// simulacrum of the thing it points at and never reliably reveals its layer. Graph
// relations (generality, is-a, era) break near-ties; grammar is only a weak prior.
// Pure + deterministic; the "understanding" is baked into the vectors beforehand,
// so runtime classification is just cosine arithmetic (no model call).

import type { Concept, Dimension, Passage } from '../types';
import { centroid, cosine } from '../ai/vec';
import { isAdjectiveHeaded } from './terms';
import { extractDates } from './chronology';

/**
 * MANY diverse exemplars per dimension. The per-dimension CENTROID of these (built
 * once into the seed's anchors) captures the dimensional *type* while averaging out
 * topic, so classifying a concept by cosine-to-centroid isn't fooled by topical
 * content (e.g. "cell"'s biology vocabulary no longer reads as the D5 "science"
 * anchor). Spanning domains is deliberate.
 */
export const DIMENSION_ANCHORS: Record<Dimension, string[]> = {
  // 1 — bare idea / existence / primitive unit (logic & math primitives)
  1: ['a number', 'a point', 'a unit', 'a set', 'a symbol', 'existence', 'truth', 'a primitive notion', 'identity', 'a definition'],
  // 2 — degree / quality / intensity (the gradience axis: more-or-less, not nouns)
  2: ['bright', 'dim', 'heavy', 'fast', 'slow', 'hot', 'cold', 'large', 'small', 'intense', 'strong', 'weak', 'a degree of something', 'a quality or attribute', 'how much or how strongly'],
  // 3 — concrete bounded form / object / body (a thing you can point to)
  3: ['an atom', 'a molecule', 'a cell', 'a gene', 'an organ', 'a body', 'a plant', 'an animal', 'a tree', 'a rock', 'a planet', 'a machine', 'a tool', 'an organism', 'a structure', 'a concrete object'],
  // 4 — process / event / period unfolding over time
  4: ['a war', 'a revolution', 'evolution', 'a process', 'an era', 'a cycle', 'a reaction', 'development over time', 'a historical period', 'growth and decay'],
  // 5 — abstract system / concept / society / field of thought
  5: ['capitalism', 'democracy', 'justice', 'a science', 'mathematics', 'a language', 'a society', 'an ideology', 'morality', 'a theory', 'a field of study'],
};

/** Short human label per dimension, for legends/UI. */
export const DIMENSION_LABEL: Record<Dimension, string> = {
  1: 'idea',
  2: 'attribute',
  3: 'form',
  4: 'temporal',
  5: 'concept',
};

const ALL: Dimension[] = [1, 2, 3, 4, 5];

/**
 * Embed each dimension's exemplars and average them into a per-dimension CENTROID
 * anchor (same vector space as the concepts). Shared by the offline build and the
 * `reclassifyDimensions` script. `embed` must return truncated unit vectors.
 */
export async function buildDimensionAnchors(
  embed: (texts: string[]) => Promise<number[][] | null>,
): Promise<Partial<Record<Dimension, number[]>>> {
  const out: Partial<Record<Dimension, number[]>> = {};
  for (const d of ALL) {
    const vecs = await embed(DIMENSION_ANCHORS[d]);
    if (vecs && vecs.length) out[d] = centroid(vecs);
  }
  return out;
}

export interface DimSignals {
  vector?: number[]; // the concept's embedding (8B, truncated to the anchors' dims)
  anchors?: Partial<Record<Dimension, number[]>>; // baked anchor vectors, same space
  isAttribute?: boolean; // grammar prior (isAdjectiveHeaded) -> D2
  generalityPct?: number; // 0..1 percentile of generality in the graph -> abstraction
  hasEra?: boolean; // any date in the concept's passages -> temporal (D4)
  hasHypernyms?: boolean; // is-a links -> bounded form (D3)
}

/**
 * Classify a concept's dimension. Primary signal: cosine of its vector to each
 * dimensional anchor (semantic). Relational signals only break NEAR-ties so they
 * never override a clear semantic read. Falls back to a coarse relational/grammar
 * estimate when no vector/anchors exist (live session without embeddings).
 */
export function conceptDimension(s: DimSignals): Dimension {
  const anchors = s.anchors;
  if (s.vector && anchors && ALL.every((d) => anchors[d]?.length)) {
    const sims = {} as Record<Dimension, number>;
    let best: Dimension = 5;
    let bestSim = -Infinity;
    for (const d of ALL) {
      const sim = cosine(s.vector, anchors[d]!);
      sims[d] = sim;
      if (sim > bestSim) {
        bestSim = sim;
        best = d;
      }
    }
    const MARGIN = 0.03; // within this of the top -> a near-tie relational nudges can settle
    const near = ALL.filter((d) => sims[d] >= bestSim - MARGIN);
    if (near.length > 1) {
      // Only nudge on signals reliable for TYPE: grammar (adjective-headed -> a
      // quality, D2) and is-a links (-> a bounded form, D3). Generality and "a
      // passage mentions a date" proved too noisy (they sent atom->D5, gene->D4).
      if (s.isAttribute && near.includes(2)) return 2;
      if (s.hasHypernyms && near.includes(3)) return 3;
    }
    return best;
  }
  // Fallback: no semantic understanding available -> coarse + honest.
  if (s.isAttribute) return 2;
  if (s.hasEra) return 4;
  if ((s.generalityPct ?? 0) > 0.66) return 5;
  if (s.hasHypernyms) return 3;
  if ((s.generalityPct ?? 0) < 0.33) return 1;
  return 3;
}

/**
 * Light dimensional annotation for a LIVE corpus (no embeddings/generality): sets
 * each concept's `dimension` from grammar + whether its passages carry dates.
 * Approximate by design; the graph re-classifies richly once enriched.
 */
export function annotateDimensionsLite(concepts: Concept[], passages: Passage[]): void {
  const dated = new Set(
    passages.filter((p) => extractDates(p.text).length > 0).map((p) => p.id),
  );
  for (const c of concepts) {
    c.dimension = conceptDimension({
      isAttribute: isAdjectiveHeaded(c.label),
      hasEra: c.passageIds.some((pid) => dated.has(pid)),
    });
  }
}
