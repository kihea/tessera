/* One-off: measure the cosine distribution of NON-co-occurring concept pairs in
 * the built seed, to choose SEMANTIC_MIN_SIM from data. `npx tsx scripts/analyzeSemantic.ts` */
import { readFileSync } from 'node:fs';
import { dequantizeVector, isQuantizedVector } from '../src/state/quantize';
import { cosine } from '../src/ai/vec';
import type { KnowledgeGraph } from '../src/state/graphStore';

const g = JSON.parse(readFileSync('public/seedGraph.json', 'utf8')) as KnowledgeGraph;
const vecs = g.concepts
  .filter((c) => isQuantizedVector((c as { vector?: unknown }).vector))
  .map((c) => ({ id: c.id, v: dequantizeVector((c as { vector: never }).vector) }));
const coKey = (a: string, b: string) => (a < b ? `${a} ${b}` : `${b} ${a}`);
const co = new Set(g.edges.map((e) => coKey(e.a, e.b)));

const perMax: number[] = [];
const all: number[] = [];
for (let i = 0; i < vecs.length; i++) {
  let max = -1;
  for (let j = 0; j < vecs.length; j++) {
    if (i === j || co.has(coKey(vecs[i].id, vecs[j].id))) continue;
    const s = cosine(vecs[i].v, vecs[j].v);
    all.push(s);
    if (s > max) max = s;
  }
  if (max > -1) perMax.push(max);
}
all.sort((a, b) => a - b);
perMax.sort((a, b) => a - b);
const pct = (arr: number[], p: number) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
console.log('vectored concepts:', vecs.length, '| non-co-occurring pairs:', all.length);
console.log('pair-sim p50/p90/p95/p99/max:', [0.5, 0.9, 0.95, 0.99].map((p) => pct(all, p).toFixed(3)).join(' / '), '/', all[all.length - 1].toFixed(3));
console.log('per-concept nearest-neighbor sim p10/p50/p90/max:', [0.1, 0.5, 0.9].map((p) => pct(perMax, p).toFixed(3)).join(' / '), '/', perMax[perMax.length - 1].toFixed(3));
for (const th of [0.55, 0.6, 0.65, 0.7, 0.75, 0.78, 0.8]) {
  let directed = 0;
  let conceptsWithAny = 0;
  for (let i = 0; i < vecs.length; i++) {
    let n = 0;
    for (let j = 0; j < vecs.length; j++) {
      if (i === j || co.has(coKey(vecs[i].id, vecs[j].id))) continue;
      if (cosine(vecs[i].v, vecs[j].v) >= th) n++;
    }
    directed += Math.min(4, n);
    if (n > 0) conceptsWithAny++;
  }
  console.log(`th ${th}: ~${Math.round(directed / 2)} edges (top4/concept), ${conceptsWithAny}/${vecs.length} concepts linked`);
}
