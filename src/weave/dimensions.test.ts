import { describe, it, expect } from 'vitest';
import { conceptDimension, annotateDimensionsLite } from './dimensions';
import type { Concept, Dimension, Passage } from '../types';

// Five near-orthogonal anchor vectors so "nearest anchor" is unambiguous.
const anchors: Record<Dimension, number[]> = {
  1: [1, 0, 0, 0, 0],
  2: [0, 1, 0, 0, 0],
  3: [0, 0, 1, 0, 0],
  4: [0, 0, 0, 1, 0],
  5: [0, 0, 0, 0, 1],
};

describe('conceptDimension', () => {
  it('classifies by the nearest anchor (semantic primary signal)', () => {
    for (const d of [1, 2, 3, 4, 5] as Dimension[]) {
      const v = anchors[d].map((x) => x * 0.9 + 0.01);
      expect(conceptDimension({ vector: v, anchors })).toBe(d);
    }
  });

  it('breaks a near-tie with a reliable relational signal, but never overrides a clear winner', () => {
    // D2/D3 within margin -> grammar (adjective-headed) settles it as the quality, D2.
    expect(conceptDimension({ vector: [0, 0.7, 0.69, 0, 0], anchors, isAttribute: true })).toBe(2);
    // D3/D5 within margin -> is-a links settle it as the bounded form, D3.
    expect(conceptDimension({ vector: [0, 0, 0.7, 0, 0.69], anchors, hasHypernyms: true })).toBe(3);
    // but a clear D5 winner is NOT pulled to D2 by grammar.
    expect(conceptDimension({ vector: [0, 0.1, 0, 0, 0.95], anchors, isAttribute: true })).toBe(5);
  });

  it('falls back to relational/grammar when there is no vector', () => {
    expect(conceptDimension({ isAttribute: true })).toBe(2);
    expect(conceptDimension({ hasEra: true })).toBe(4);
    expect(conceptDimension({ generalityPct: 0.9 })).toBe(5);
    expect(conceptDimension({ hasHypernyms: true })).toBe(3);
    expect(conceptDimension({ generalityPct: 0.1 })).toBe(1);
  });
});

describe('annotateDimensionsLite', () => {
  it('tags dated concepts D4 and adjective-headed ones D2', () => {
    const passages: Passage[] = [
      { id: 'p1', docId: 'd', text: 'It happened in 1789 during the revolution.', index: 0 },
      { id: 'p2', docId: 'd', text: 'A general description without any dates.', index: 1 },
    ];
    const concepts: Concept[] = [
      { id: 'revolution', label: 'revolution', df: 1, weight: 1, passageIds: ['p1'] },
      { id: 'ancient', label: 'ancient', df: 1, weight: 1, passageIds: ['p2'] },
    ];
    annotateDimensionsLite(concepts, passages);
    expect(concepts[0].dimension).toBe(4);
    expect(concepts[1].dimension).toBe(2);
  });
});
