import { describe, it, expect } from 'vitest';
import {
  applyVectorSignals,
  conceptContext,
  edgeDegree,
  edgeIntensity,
  emptyGraph,
  mergeIntoGraph,
  nodeKind,
  rebuildSemanticEdges,
  searchGraph,
  subgraphToCorpus,
} from './graphStore';
import type { GraphConcept, KnowledgeGraph } from './graphStore';
import type { Concept, Passage, SourceDoc } from '../types';

function sampleContribution() {
  const docs: SourceDoc[] = [
    { id: 'd1', provider: 'Wikipedia', sourceType: 'encyclopedia', title: 'Empire', url: 'http://x/empire' },
  ];
  const passages: Passage[] = [
    { id: 'p1', docId: 'd1', text: 'The ancient empire was a large political state.', index: 0 },
    { id: 'p2', docId: 'd1', text: 'The empire built roads across its territory.', index: 1 },
  ];
  const concepts: Concept[] = [
    { id: 'empire', label: 'empire', df: 2, weight: 1, passageIds: ['p1', 'p2'], important: true },
    { id: 'ancient', label: 'ancient', df: 1, weight: 1, passageIds: ['p1'], important: true },
    { id: 'road', label: 'road', df: 1, weight: 1, passageIds: ['p2'], important: true },
  ];
  return { query: 'empire', docs, passages, concepts, formulas: [] };
}

describe('nodeKind / edgeDegree', () => {
  it('classifies forms vs attributes by the label heuristic', () => {
    expect(nodeKind({ label: 'empire' })).toBe('form');
    expect(nodeKind({ label: 'ancient' })).toBe('attribute');
    expect(nodeKind({ label: 'pig', kind: 'attribute' })).toBe('attribute'); // stored wins
  });
  it('falls back to a normalized weight when degree is unset', () => {
    expect(edgeDegree({ a: 'x', b: 'y', weight: 6, kind: 'associative', passageIds: [] })).toBe(1);
    expect(edgeDegree({ a: 'x', b: 'y', weight: 0, kind: 'associative', passageIds: [], degree: 0.3 })).toBe(0.3);
  });
});

describe('mergeIntoGraph', () => {
  it('folds concepts in and types a form-attribute edge as has-attribute', () => {
    const g = mergeIntoGraph(emptyGraph(), sampleContribution());
    expect(g.concepts.map((c) => c.id).sort()).toEqual(['ancient', 'empire', 'road']);
    expect(g.passages).toHaveLength(2);

    const empire = g.concepts.find((c) => c.id === 'empire')!;
    expect(empire.kind).toBe('form');
    expect(g.concepts.find((c) => c.id === 'ancient')!.kind).toBe('attribute');

    const attrEdge = g.edges.find(
      (e) => [e.a, e.b].includes('empire') && [e.a, e.b].includes('ancient'),
    );
    expect(attrEdge?.kind).toBe('attribute');
    const assocEdge = g.edges.find(
      (e) => [e.a, e.b].includes('empire') && [e.a, e.b].includes('road'),
    );
    expect(assocEdge?.kind).toBe('associative');
  });

  it('dedups identical material on a second merge (no duplicate passages)', () => {
    const g = mergeIntoGraph(emptyGraph(), sampleContribution());
    const passagesAfterFirst = g.passages.length;
    mergeIntoGraph(g, sampleContribution());
    expect(g.passages.length).toBe(passagesAfterFirst);
    expect(g.concepts.find((c) => c.id === 'empire')!.df).toBe(2);
  });
});

describe('searchGraph / subgraphToCorpus', () => {
  it('finds a topic and rehydrates a coherent corpus', () => {
    const g = mergeIntoGraph(emptyGraph(), sampleContribution());
    const sub = searchGraph(g, 'empire');
    expect(sub.conceptIds).toContain('empire');
    expect(sub.passages.length).toBeGreaterThan(0);

    const corpus = subgraphToCorpus(g, sub.conceptIds);
    expect(corpus.concepts.find((c) => c.id === 'empire')?.kind).toBe('form');
    // every concept's passageIds must reference a passage present in the corpus
    const present = new Set(corpus.passages.map((p) => p.id));
    for (const c of corpus.concepts) {
      for (const pid of c.passageIds) expect(present.has(pid)).toBe(true);
    }
  });

  it('returns nothing for a topic absent from the graph', () => {
    const g = mergeIntoGraph(emptyGraph(), sampleContribution());
    expect(searchGraph(g, 'photosynthesis').conceptIds).toHaveLength(0);
  });
});

function concept(p: Partial<GraphConcept> & { id: string; label: string }): GraphConcept {
  return { df: 1, passageIds: [], important: true, generality: 0, topics: [], ...p };
}

describe('conceptContext', () => {
  it('assembles a holistic context: definition, attributes, neighbours, passages', () => {
    const g: KnowledgeGraph = emptyGraph();
    g.passages = [{ id: 'p1', docId: 'd1', text: 'A pig is a domesticated mammal kept for meat.', index: 0 }];
    g.concepts = [
      concept({ id: 'pig', label: 'pig', passageIds: ['p1'], kind: 'form', definition: { text: 'a hoofed mammal', url: 'u', source: 'Wiktionary' } }),
      concept({ id: 'pink', label: 'pink', kind: 'attribute' }),
      concept({ id: 'mammal', label: 'mammal', kind: 'form' }),
    ];
    g.edges = [
      { a: 'pig', b: 'pink', weight: 1, kind: 'attribute', degree: 0.5, passageIds: ['p1'] },
      { a: 'mammal', b: 'pig', weight: 1, kind: 'associative', degree: 0.5, passageIds: ['p1'] },
    ];
    const ctx = conceptContext(g, g.concepts[0]);
    expect(ctx).toContain('pig');
    expect(ctx).toContain('hoofed mammal'); // definition
    expect(ctx).toContain('pink'); // attribute (Qualities)
    expect(ctx).toContain('mammal'); // related neighbour
    expect(ctx).toContain('domesticated'); // its own passage
    expect(conceptContext(g, g.concepts[0])).toBe(ctx); // deterministic
  });
});

describe('rebuildSemanticEdges', () => {
  it('links near vectors that do not co-occur, and skips far / co-occurring pairs', () => {
    const g: KnowledgeGraph = emptyGraph();
    g.concepts = [
      concept({ id: 'a', label: 'a', vector: [1, 0, 0] }),
      concept({ id: 'b', label: 'b', vector: [0.99, 0.01, 0] }), // near a
      concept({ id: 'c', label: 'c', vector: [0, 1, 0] }), // far from both
    ];
    rebuildSemanticEdges(g);
    const has = (x: string, y: string) =>
      (g.semanticEdges ?? []).some((e) => [e.a, e.b].includes(x) && [e.a, e.b].includes(y));
    expect(has('a', 'b')).toBe(true);
    expect(has('a', 'c')).toBe(false);
    expect(has('b', 'c')).toBe(false);
  });

  it('does not duplicate an existing co-occurrence edge as semantic', () => {
    const g: KnowledgeGraph = emptyGraph();
    g.concepts = [
      concept({ id: 'a', label: 'a', vector: [1, 0, 0] }),
      concept({ id: 'b', label: 'b', vector: [1, 0, 0] }),
    ];
    g.edges = [{ a: 'a', b: 'b', weight: 1, kind: 'associative', degree: 0.5, passageIds: ['p'] }];
    rebuildSemanticEdges(g);
    expect(g.semanticEdges).toHaveLength(0);
  });
});

describe('applyVectorSignals', () => {
  it('blends vector similarity into edge degree', () => {
    const g = mergeIntoGraph(emptyGraph(), sampleContribution());
    for (const c of g.concepts) if (c.id === 'empire' || c.id === 'ancient') c.vector = [1, 0, 0];
    applyVectorSignals(g);
    const edge = g.edges.find(
      (e) => [e.a, e.b].includes('empire') && [e.a, e.b].includes('ancient'),
    )!;
    // identical vectors (cos = 1) => degree gets at least the 0.4 * sim term
    expect(edge.degree).toBeGreaterThanOrEqual(0.4);
    expect(edge.degree).toBeLessThanOrEqual(1);
  });
});

function contrastContribution() {
  const docs: SourceDoc[] = [
    { id: 'd1', provider: 'Wikipedia', sourceType: 'encyclopedia', title: 'Economics', url: 'http://x/econ' },
  ];
  const passages: Passage[] = [
    { id: 'p1', docId: 'd1', text: 'Capitalism, unlike socialism, relies on private ownership versus collective control.', index: 0 },
    { id: 'p2', docId: 'd1', text: 'Critics contrast capitalism with socialism; the two systems are often opposed.', index: 2 },
  ];
  const concepts: Concept[] = [
    { id: 'capitalism', label: 'capitalism', df: 2, weight: 1, passageIds: ['p1', 'p2'], important: true },
    { id: 'socialism', label: 'socialism', df: 2, weight: 1, passageIds: ['p1', 'p2'], important: true },
  ];
  return { query: 'capitalism', docs, passages, concepts, formulas: [] };
}

describe('signed intensity & relevance ranking', () => {
  it('edgeIntensity returns the signed value, or falls back to degree', () => {
    expect(edgeIntensity({ a: 'x', b: 'y', weight: 0, kind: 'associative', passageIds: [], degree: 0.5, intensity: -0.4 })).toBe(-0.4);
    expect(edgeIntensity({ a: 'x', b: 'y', weight: 0, kind: 'associative', passageIds: [], degree: 0.5 })).toBe(0.5);
  });

  it('signs a contrast-framed relation negative and an affirmative one positive', () => {
    const g = mergeIntoGraph(emptyGraph(), contrastContribution());
    const tension = g.edges.find((e) => [e.a, e.b].includes('capitalism') && [e.a, e.b].includes('socialism'))!;
    expect(tension.intensity).toBeLessThan(0); // "unlike / versus / contrast / opposed" -> repulsion
    expect(tension.degree).toBeLessThan(Math.abs(tension.intensity!) + 1e-9); // contrast damped for traversal

    const g2 = mergeIntoGraph(emptyGraph(), sampleContribution());
    const affirm = g2.edges.find((e) => [e.a, e.b].includes('empire') && [e.a, e.b].includes('road'))!;
    expect(affirm.intensity).toBeGreaterThan(0);
  });

  it('ranks a tightly-bound concept above a broad co-mention (relevance, not raw frequency)', () => {
    const g = emptyGraph();
    const P = (id: string): Passage => ({ id, docId: 'd1', text: id, index: 0 });
    g.docs = [{ id: 'd1', provider: 'Wikipedia', sourceType: 'encyclopedia', title: 't', url: 'http://x/d1', firstSeen: 0, topics: [] }];
    g.passages = ['p1', 'p2', 'p3', 'q1', 'q2', 'q3', 'q4'].map(P);
    g.concepts = [
      concept({ id: 'subject', label: 'subject', kind: 'form', passageIds: ['p1', 'p2', 'p3'] }),
      concept({ id: 'corefact', label: 'corefact', kind: 'form', passageIds: ['p1', 'p2'] }), // all within the subject
      concept({ id: 'tangent', label: 'tangent', kind: 'form', passageIds: ['p2', 'q1', 'q2', 'q3', 'q4'] }), // mostly elsewhere
    ];
    // The tangent has the STRONGER raw link (degree/intensity 1.0 > 0.9): under the old
    // degree-only ranking it would win. Relevance-to-subject must still prefer corefact.
    g.edges = [
      { a: 'corefact', b: 'subject', weight: 2, kind: 'associative', degree: 0.9, intensity: 0.9, passageIds: ['p1', 'p2'] },
      { a: 'subject', b: 'tangent', weight: 2, kind: 'associative', degree: 1, intensity: 1, passageIds: ['p2'] },
    ];
    const sub = searchGraph(g, 'subject', { maxNodes: 2, maxHops: 1 });
    expect(sub.conceptIds).toContain('corefact');
    expect(sub.conceptIds).not.toContain('tangent');
  });

  it('does not flip an affirmative edge on incidental "not"/"against" in prose', () => {
    const docs: SourceDoc[] = [
      { id: 'd1', provider: 'Wikipedia', sourceType: 'encyclopedia', title: 'Immunity', url: 'http://x/imm' },
    ];
    const passages: Passage[] = [
      { id: 'p1', docId: 'd1', text: 'Vaccines protect the body against disease, not only in children.', index: 0 },
      { id: 'p2', docId: 'd1', text: 'A vaccine trains the immune system; it does not weaken the body.', index: 2 },
    ];
    const concepts: Concept[] = [
      { id: 'vaccine', label: 'vaccine', df: 2, weight: 1, passageIds: ['p1', 'p2'], important: true },
      { id: 'body', label: 'body', df: 2, weight: 1, passageIds: ['p1', 'p2'], important: true },
    ];
    const g = mergeIntoGraph(emptyGraph(), { query: 'vaccine', docs, passages, concepts, formulas: [] });
    const e = g.edges.find((x) => [x.a, x.b].includes('vaccine') && [x.a, x.b].includes('body'))!;
    expect(e.intensity).toBeGreaterThan(0); // "against"/"not only"/"does not" are not opposition
  });

  it('keeps contrast damping coupled through vector enrichment (degree = 0.3*|intensity|)', () => {
    const g = mergeIntoGraph(emptyGraph(), contrastContribution());
    for (const c of g.concepts) c.vector = c.id === 'capitalism' ? [1, 0, 0] : [0.9, 0.1, 0];
    applyVectorSignals(g);
    const e = g.edges.find((x) => [x.a, x.b].includes('capitalism') && [x.a, x.b].includes('socialism'))!;
    expect(e.intensity).toBeLessThan(0);
    expect(e.degree).toBeCloseTo(0.3 * Math.abs(e.intensity!), 5);
  });

  it('matches topic tokens as whole words, not substrings (no "the" -> "theory")', () => {
    const g = emptyGraph();
    const P = (id: string, text: string): Passage => ({ id, docId: 'd1', text, index: 0 });
    g.docs = [{ id: 'd1', provider: 'Wikipedia', sourceType: 'encyclopedia', title: 't', url: 'http://x/d1', firstSeen: 0, topics: [] }];
    g.passages = [P('pe', 'The empire spanned three continents.'), P('pt', 'A scientific theory explains observations.')];
    g.concepts = [
      concept({ id: 'empire', label: 'empire', kind: 'form', passageIds: ['pe'] }),
      concept({ id: 'theory', label: 'theory', kind: 'form', passageIds: ['pt'] }),
    ];
    const sub = searchGraph(g, 'the empire');
    expect(sub.conceptIds).toContain('empire');
    expect(sub.conceptIds).not.toContain('theory'); // "the" must not substring-match "theory"
  });

  it('seeds search from topic provenance when the topic name is not itself a concept', () => {
    const g = emptyGraph();
    g.docs = [{ id: 'd1', provider: 'Wikipedia', sourceType: 'encyclopedia', title: 't', url: 'http://x/d1', firstSeen: 0, topics: ['the Roman Empire'] }];
    g.passages = [{ id: 'p1', docId: 'd1', text: 'The emperor ruled from the capital.', index: 0 }];
    g.concepts = [
      concept({ id: 'emperor', label: 'emperor', kind: 'form', passageIds: ['p1'], topics: ['the Roman Empire'] }),
      concept({ id: 'capital', label: 'capital', kind: 'form', passageIds: ['p1'], topics: ['the Roman Empire'] }),
    ];
    // "roman"/"empire" are query words, excluded from extraction, so no concept is
    // named after the topic -- provenance is the only thing that can seed it.
    const sub = searchGraph(g, 'the Roman Empire');
    expect(sub.conceptIds).toContain('emperor');
  });
});
