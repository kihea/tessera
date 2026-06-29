/*
 * Build the bundled baseline knowledge graph -> public/seedGraph.json.
 *
 * Run OFFLINE in Node 18+ (global fetch), not in the app:
 *     npx tsx scripts/buildSeedGraph.ts
 *
 * It researches a curated "canon" of foundational topics with the app's own
 * pipeline, weaves each into a corpus, and folds them into one graph using the
 * exact same mergeIntoGraph the app uses at runtime. Only freely
 * REDISTRIBUTABLE sources are kept (Wikipedia/Wikibooks/Wikisource/Wikinews
 * CC BY-SA, OpenAlex/Crossref abstracts, public-domain archives) -- copyrighted
 * news (Guardian/NYT/GNews), Google Scholar snippets, YouTube transcripts, and
 * Hacker News comments are dropped, since the result ships with the app.
 *
 * Vectors: if an embeddings model is reachable (see scripts/embedNode.ts and the
 * TESSERA_EMBED_* env vars) every important concept is embedded, the geometric
 * signals are folded in (semantic edges, vector-blended intensity), and the
 * vectors are int8-quantized into the bundle. With no model reachable the build
 * still produces a valid topology-only bundle and warns.
 *
 * Env knobs:
 *   RESUME=1            continue a previous run (skip topics already in the graph)
 *   POLITE_EMAIL=...    OpenAlex polite-pool email (better rate limits)
 *   OPENALEX_API_KEY    OpenAlex premium key (optional)
 *   EMBED_MAX=N         cap how many concepts to embed (default: all important)
 *   TOPIC_DELAY_MS=N    pause between topics (default 1200)
 */

// A minimal localStorage shim so the providers' settings reads resolve in Node
// (they're all try/catch-guarded, but this lets us pass a polite-pool email and
// turn OFF the IndexedDB-backed graph provider, which has nothing to read here).
// Installed before main(); providers read settings lazily, so this is in time.
{
  const g = globalThis as unknown as { localStorage?: Storage };
  if (typeof g.localStorage === 'undefined') {
    const store = new Map<string, string>([
      [
        'tessera:settings',
        JSON.stringify({
          politeEmail: process.env.POLITE_EMAIL,
          openAlexApiKey: process.env.OPENALEX_API_KEY,
          dev: { graphProvider: false }, // no IndexedDB during the offline build
        }),
      ],
    ]);
    g.localStorage = {
      getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    } as Storage;
  }
}

import { writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { research } from '../src/research/providers';
import { extractConcepts } from '../src/weave/terms';
import { annotateDefinitions, buildConnections } from '../src/weave/connections';
import { annotateDepth } from '../src/weave/depth';
import {
  emptyGraph,
  mergeIntoGraph,
  conceptContext,
  applyVectorSignals,
  rebuildSemanticEdges,
  hash,
  type KnowledgeGraph,
} from '../src/state/graphStore';
import { quantizeVector } from '../src/state/quantize';
import { embedAll, probeEmbedder, embedderInfo } from './embedNode';
import { classifyDimensionsByLabel } from './classifyDimensions';

const OUT = 'public/seedGraph.json';

// Providers whose excerpts are safe to redistribute inside the bundled asset.
const ALLOW = [
  'Wikipedia',
  'Wikibooks',
  'Wikisource',
  'Wikinews',
  'OpenAlex',
  'Cited by Wikipedia',
  'Crossref',
  'Internet Archive',
  'Chronicling America',
  'Open Library',
];
const redistributable = (provider: string) => ALLOW.some((a) => provider.startsWith(a));

// A modest starter canon -- roughly a high-school graduate's breadth across the
// sciences, math, history, civics, literature, and the arts. Grow freely.
const CANON = [
  'the scientific method',
  'evolution by natural selection',
  'the cell',
  'DNA and genetics',
  'photosynthesis',
  'Newton’s laws of motion',
  'electricity and magnetism',
  'the periodic table',
  'atomic theory',
  'thermodynamics',
  'quantum mechanics',
  'plate tectonics',
  'the water cycle',
  'climate change',
  'the solar system',
  'the human brain',
  'vaccines and immunity',
  'algebra',
  'geometry',
  'calculus',
  'probability and statistics',
  'supply and demand',
  'capitalism',
  'socialism',
  'the French Revolution',
  'World War I',
  'World War II',
  'the American Civil War',
  'the Industrial Revolution',
  'the Roman Empire',
  'ancient Egypt',
  'the Cold War',
  'the United States Constitution',
  'democracy',
  'the Enlightenment',
  'the Renaissance',
  'Shakespeare',
  'music theory',
  'world religions',
  'the printing press',
  'photosynthesis vs cellular respiration',
  'human body systems',
  'ecosystems and food webs',
  'the theory of relativity',
  'artificial intelligence',
  'computers and how they work',
  'the internet',
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Research one topic, retrying a couple of times on transient failure. */
async function researchTopic(query: string) {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(1500 * attempt);
    try {
      return await research(query, () => {});
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

/** Serialize the graph for the bundle: concept vectors int8-quantized to stay small. */
function bundleJson(graph: KnowledgeGraph): string {
  const concepts = graph.concepts.map((c) => {
    if (c.vector && c.vector.length) {
      const { vector, ...rest } = c;
      return { ...rest, vector: quantizeVector(vector) };
    }
    return c;
  });
  return JSON.stringify({ ...graph, concepts });
}

/** Embed every important concept and fold in the geometric signals. */
async function enrich(graph: KnowledgeGraph): Promise<{ embedded: number; ok: boolean }> {
  const max = Number(process.env.EMBED_MAX) || Infinity;
  const candidates = graph.concepts
    .filter((c) => c.important)
    .map((c) => ({ c, ctx: conceptContext(graph, c) }))
    .filter(({ c, ctx }) => c.vectorHash !== hash(ctx))
    .sort((a, b) => b.c.df - a.c.df)
    .slice(0, max);
  let embedded = 0;
  if (candidates.length > 0) {
    const BATCH = Number(process.env.EMBED_BATCH) || 16; // small: 8B chokes on big batches
    console.log(`embedding ${candidates.length} concepts (${embedderInfo()}, batch ${BATCH}) …`);
    for (let i = 0; i < candidates.length; i += BATCH) {
      const chunk = candidates.slice(i, i + BATCH);
      const vecs = await embedAll(chunk.map((x) => x.ctx), { batchSize: BATCH });
      if (!vecs || vecs.length !== chunk.length) {
        console.warn(`  chunk ${i}-${i + chunk.length} failed — leaving those unembedded`);
        continue; // tolerate: a bad batch must not throw away every embedding
      }
      chunk.forEach(({ c, ctx }, j) => {
        c.vector = vecs[j];
        c.vectorHash = hash(ctx);
      });
      embedded += chunk.length;
      if (i % (BATCH * 5) === 0 || i + BATCH >= candidates.length)
        console.log(`  embedded ${embedded}/${candidates.length}`);
    }
    if (embedded === 0) return { embedded: 0, ok: false };
    applyVectorSignals(graph);
    rebuildSemanticEdges(graph);
  }

  // Bake the dimensional anchor centroids + classify every concept by its LABEL
  // (type-pure; the context vector is process-polluted -- see classifyDimensions).
  const batch = Number(process.env.EMBED_BATCH) || 16;
  const dimOk = await classifyDimensionsByLabel(graph, (t) => embedAll(t, { batchSize: batch }));
  console.log(dimOk ? 'classified dimensions by label' : '⚠ dimension classification failed');

  return { embedded, ok: true };
}

async function main() {
  // Fail fast: don't burn the ~10-min research run only to discover the embedder
  // is down and silently ship a topology-only seed (set ALLOW_TOPOLOGY=1 to opt in).
  if (!(await probeEmbedder()) && process.env.ALLOW_TOPOLOGY !== '1') {
    console.error(`\n✗ embeddings model not reachable (${embedderInfo()}).`);
    console.error('  Start Ollama (ollama serve) and pull qwen3-embedding:0.6b, or set');
    console.error('  ALLOW_TOPOLOGY=1 to build a vector-less seed on purpose. Aborting.');
    process.exit(1);
  }

  const resume = process.env.RESUME === '1' && existsSync(OUT);
  let graph = emptyGraph();
  if (resume) {
    try {
      const prev = JSON.parse(await readFile(OUT, 'utf8')) as KnowledgeGraph;
      if (prev?.version === 1 && prev.concepts.length > 0) {
        graph = prev;
        // a prior FULL run may have quantized vectors; we only re-embed after the
        // loop and re-quantize on write, so drop stale vectors to keep types sane.
        for (const c of graph.concepts) delete c.vector;
        console.log(`resuming — ${graph.topics.length} topics, ${graph.concepts.length} concepts already in graph`);
      }
    } catch {
      /* corrupt partial — start fresh */
    }
  }

  const done = new Set(graph.topics.map((t) => t.query));
  const topicDelay = Number(process.env.TOPIC_DELAY_MS) || 1200;
  // LIMIT=n smoke-tests the pipeline on the first n canon topics.
  const topics = process.env.LIMIT ? CANON.slice(0, Number(process.env.LIMIT)) : CANON;

  for (const query of topics) {
    if (done.has(query)) {
      console.log(`= ${query} (already in graph, skipping)`);
      continue;
    }
    try {
      const seed = await researchTopic(query);
      const docs = seed.docs.filter((d) => redistributable(d.provider));
      const docIds = new Set(docs.map((d) => d.id));
      const passages = seed.passages.filter((p) => docIds.has(p.docId));
      if (passages.length < 3) {
        console.warn(`skip "${query}" (too little redistributable material)`);
        continue;
      }
      const concepts = extractConcepts(passages, query);
      annotateDefinitions(passages, concepts);
      const docMap = new Map(docs.map((d) => [d.id, d]));
      annotateDepth(passages, docMap, concepts);
      buildConnections(passages, concepts); // warms definedByPassage side effects
      mergeIntoGraph(graph, { query, docs, passages, concepts, formulas: seed.formulas });
      console.log(`+ ${query}: ${passages.length} passages, graph now ${graph.concepts.length} concepts`);
      // Incremental, crash-safe write of the topology so far (no vectors yet).
      await writeFile(OUT, bundleJson(graph));
    } catch (e) {
      console.warn(`failed "${query}":`, e);
    }
    await sleep(topicDelay);
  }

  // Optional embeddings pass -- only if a model is actually reachable.
  let embedNote = 'topology only (no embeddings model reachable)';
  if (await probeEmbedder()) {
    const { embedded, ok } = await enrich(graph);
    embedNote = ok
      ? `${embedded} concepts embedded, ${graph.semanticEdges?.length ?? 0} semantic edges`
      : 'embeddings model failed mid-run — shipping topology only';
  } else {
    console.warn(`\n⚠ no embeddings model reachable (${embedderInfo()}). Set up Ollama`);
    console.warn('  (ollama pull qwen3-embedding:0.6b && ollama serve) or OPENAI_API_KEY for vectors.');
  }

  await writeFile(OUT, bundleJson(graph));
  console.log(
    `\nWrote ${OUT} — ${graph.docs.length} docs, ${graph.passages.length} passages, ` +
      `${graph.concepts.length} concepts, ${graph.edges.length} edges. ${embedNote}.`,
  );
}

main();
