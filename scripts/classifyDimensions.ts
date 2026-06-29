/*
 * Shared dimensional classification for the offline scripts (build + reclassify).
 *
 * Classifies each concept's dimension from its LABEL embedded as a bare phrase, NOT
 * from its context vector. A concept's context vector is polluted by the processes
 * its article describes -- "a cell"'s text is full of division/growth/cycle, so the
 * context reads as temporal (D4) even though a cell is a concrete form (D3). The
 * label embeds the TYPE cleanly. We temporarily swap the label vector in as
 * c.vector so the pure `annotateDimensions` classifier reads it, then restore the
 * context vectors (which drive semantic edges) untouched.
 */

import { annotateDimensions, type KnowledgeGraph } from '../src/state/graphStore';
import { buildDimensionAnchors } from '../src/weave/dimensions';

export async function classifyDimensionsByLabel(
  graph: KnowledgeGraph,
  embed: (texts: string[]) => Promise<number[][] | null>,
): Promise<boolean> {
  graph.dimensionAnchors = await buildDimensionAnchors(embed);
  if (Object.keys(graph.dimensionAnchors).length !== 5) return false;

  const labelVecs = await embed(graph.concepts.map((c) => c.label));
  if (!labelVecs || labelVecs.length !== graph.concepts.length) return false;

  // Classify the whole graph from LABEL vectors (the context vectors are left alone
  // -- they drive semantic edges). `vectorFor` feeds the label vector to the shared
  // classifier without disturbing c.vector.
  const labelMap = new Map(graph.concepts.map((c, i) => [c.id, labelVecs[i]] as const));
  annotateDimensions(graph, { vectorFor: (c) => labelMap.get(c.id) });
  return true;
}
