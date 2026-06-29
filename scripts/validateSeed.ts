/*
 * Sanity-check the built public/seedGraph.json the way the runtime will read it.
 *     npx tsx scripts/validateSeed.ts
 * Exercises the real decode path (state/quantize) and reports vector health,
 * dimensionality, semantic-edge coverage, and a degree/intensity sample.
 */
import { readFileSync, statSync } from 'node:fs';
import { dequantizeVector, isQuantizedVector } from '../src/state/quantize';
import { cosine } from '../src/ai/vec';
import type { KnowledgeGraph } from '../src/state/graphStore';

const PATH = 'public/seedGraph.json';
const raw = readFileSync(PATH, 'utf8');
const g = JSON.parse(raw) as KnowledgeGraph;
const sizeMB = (statSync(PATH).size / 1024 / 1024).toFixed(2);

const concepts = g.concepts as (KnowledgeGraph['concepts'][number] & { vector?: unknown })[];
const quantized = concepts.filter((c) => isQuantizedVector(c.vector));
const dims = new Set<number>();
let zeroVecs = 0;
let decodedOk = 0;
for (const c of quantized) {
  const v = dequantizeVector(c.vector as never);
  dims.add(v.length);
  const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  if (mag === 0) zeroVecs++;
  else decodedOk++;
}

// A real semantic relationship should read as high cosine on decode.
let sampleSim = 'n/a';
const se = g.semanticEdges ?? [];
if (se.length) {
  const byId = new Map(concepts.map((c) => [c.id, c]));
  const e = se[0];
  const a = byId.get(e.a)?.vector;
  const b = byId.get(e.b)?.vector;
  if (isQuantizedVector(a) && isQuantizedVector(b)) {
    sampleSim = `${e.a} ~ ${e.b} = ${cosine(dequantizeVector(a as never), dequantizeVector(b as never)).toFixed(3)} (stored ${e.degree.toFixed(3)})`;
  }
}

const withDegree = g.edges.filter((e) => typeof e.degree === 'number').length;
const sampleEdge = g.edges.slice().sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0))[0];

console.log(`file: ${PATH}  (${sizeMB} MB)`);
console.log(`docs ${g.docs.length} · passages ${g.passages.length} · concepts ${g.concepts.length} · edges ${g.edges.length}`);
console.log(`vectors: ${quantized.length} quantized · decoded ok ${decodedOk} · zero ${zeroVecs} · dims ${[...dims].join(',')}`);
console.log(`semantic edges: ${se.length}  sample: ${sampleSim}`);
console.log(`edges with degree: ${withDegree}/${g.edges.length}  top: ${sampleEdge ? `${sampleEdge.a}~${sampleEdge.b} d=${(sampleEdge.degree ?? 0).toFixed(2)} (${sampleEdge.kind})` : 'none'}`);
console.log(`topics: ${g.topics.length}  formulas: ${g.formulas.length}  notes: ${g.notes.length}`);

// Dimensional classification health (Round 2): distribution, baked anchors, spot-checks.
const dimDist: Record<string, number> = {};
for (const c of concepts) {
  const k = `D${(c as { dimension?: number }).dimension ?? '?'}`;
  dimDist[k] = (dimDist[k] ?? 0) + 1;
}
const anchors = (g as { dimensionAnchors?: Record<string, number[]> }).dimensionAnchors;
const anchorInfo = anchors ? `${Object.keys(anchors).length} × ${anchors['5']?.length ?? '?'}d` : 'MISSING';
const findC = (s: string) => concepts.find((c) => c.id === s || c.label.toLowerCase() === s);
const spot = ['capitalism', 'cell', 'war', 'energy', 'atom', 'democracy']
  .map((s) => {
    const c = findC(s);
    return c ? `${s}→D${(c as { dimension?: number }).dimension}` : '';
  })
  .filter(Boolean)
  .join('  ');
console.log(`dimensions: ${JSON.stringify(dimDist)}  anchors: ${anchorInfo}`);
console.log(`  spot-check: ${spot}`);
