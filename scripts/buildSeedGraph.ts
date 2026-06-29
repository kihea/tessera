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
 * The committed public/seedGraph.json is an empty placeholder until this runs.
 */

import { writeFile } from 'node:fs/promises';
import { research } from '../src/research/providers';
import { extractConcepts } from '../src/weave/terms';
import { annotateDefinitions, buildConnections } from '../src/weave/connections';
import { annotateDepth } from '../src/weave/depth';
import { emptyGraph, mergeIntoGraph } from '../src/state/graphStore';

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

// A modest starter canon -- roughly a high-school graduate's breadth across
// the sciences, math, history, civics, literature, and the arts. Grow freely.
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
  'plate tectonics',
  'the water cycle',
  'climate change',
  'the solar system',
  'algebra',
  'geometry',
  'calculus',
  'probability and statistics',
  'supply and demand',
  'the French Revolution',
  'World War II',
  'the Industrial Revolution',
  'the Roman Empire',
  'the Cold War',
  'the United States Constitution',
  'democracy',
  'the Enlightenment',
  'the Renaissance',
  'Shakespeare',
  'the printing press',
  'photosynthesis vs cellular respiration',
  'human body systems',
  'ecosystems and food webs',
  'the theory of relativity',
  'computers and how they work',
  'the internet',
];

async function main() {
  const graph = emptyGraph();
  for (const query of CANON) {
    try {
      const seed = await research(query, () => {});
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
    } catch (e) {
      console.warn(`failed "${query}":`, e);
    }
  }
  await writeFile('public/seedGraph.json', JSON.stringify(graph));
  console.log(
    `\nWrote public/seedGraph.json — ${graph.docs.length} docs, ${graph.passages.length} passages, ${graph.concepts.length} concepts, ${graph.edges.length} edges.`,
  );
}

main();
