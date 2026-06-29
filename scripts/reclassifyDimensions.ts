/*
 * Re-classify the seed graph's dimensions WITHOUT a full rebuild.
 *
 *     EMBED_MODEL=qwen3-embedding:latest EMBED_DIMS=1024 npx tsx scripts/reclassifyDimensions.ts
 *
 * Reuses the concept vectors already baked into public/seedGraph.json (decodes the
 * int8 quantization), re-embeds only the anchor exemplars + concept labels, re-runs
 * the shared label-based classifier, and re-quantizes on write. Lets us iterate on
 * the anchors / classifier in ~1 min instead of the ~20-min embedding rebuild.
 */

import { writeFile, readFile } from 'node:fs/promises';
import type { KnowledgeGraph } from '../src/state/graphStore';
import { dequantizeVector, isQuantizedVector, quantizeVector } from '../src/state/quantize';
import { embedAll, probeEmbedder, embedderInfo } from './embedNode';
import { classifyDimensionsByLabel } from './classifyDimensions';

const OUT = 'public/seedGraph.json';

async function main() {
  if (!(await probeEmbedder())) {
    console.error(`✗ embedder not reachable (${embedderInfo()}). Start Ollama. Aborting.`);
    process.exit(1);
  }
  const graph = JSON.parse(await readFile(OUT, 'utf8')) as KnowledgeGraph;

  // Decode the baked (quantized) context vectors so the classifier can preserve them.
  let withVec = 0;
  for (const c of graph.concepts) {
    const v = c.vector as unknown;
    if (isQuantizedVector(v)) {
      c.vector = dequantizeVector(v);
      withVec++;
    } else if (Array.isArray(v) && v.length) {
      withVec++;
    }
  }
  console.log(`loaded ${graph.concepts.length} concepts (${withVec} with context vectors)`);

  console.log(`re-embedding anchors + ${graph.concepts.length} labels (${embedderInfo()}) …`);
  const ok = await classifyDimensionsByLabel(graph, (t) => embedAll(t, { batchSize: 8 }));
  if (!ok) {
    console.error('✗ classification failed (anchors or labels). Seed left untouched.');
    process.exit(1);
  }

  // Re-quantize concept vectors for the bundle (mirror buildSeedGraph.bundleJson).
  const concepts = graph.concepts.map((c) =>
    c.vector && c.vector.length
      ? { ...c, vector: quantizeVector(c.vector) as unknown as number[] }
      : c,
  );
  await writeFile(OUT, JSON.stringify({ ...graph, concepts }));

  const d: Record<string, number> = {};
  for (const c of graph.concepts) {
    const k = 'D' + (c.dimension ?? '?');
    d[k] = (d[k] || 0) + 1;
  }
  console.log('reclassified:', JSON.stringify(d));
}

main();
