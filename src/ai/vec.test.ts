import { describe, it, expect } from 'vitest';
import { centroid, cosine, dot, norm, truncateUnit } from './vec';

describe('vec', () => {
  it('dot and norm', () => {
    expect(dot([1, 2, 3], [4, 5, 6])).toBe(32);
    expect(norm([3, 4])).toBe(5);
  });

  it('cosine of identical vectors is 1', () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  it('cosine of orthogonal vectors is 0', () => {
    expect(cosine([1, 0], [0, 1])).toBe(0);
  });

  it('cosine is safe for zero / mismatched / empty vectors', () => {
    expect(cosine([0, 0], [1, 1])).toBe(0);
    expect(cosine([1], [1, 2])).toBe(0);
    expect(cosine([], [])).toBe(0);
  });

  it('centroid is the component-wise mean', () => {
    expect(centroid([[0, 0], [2, 4]])).toEqual([1, 2]);
    expect(centroid([])).toEqual([]);
  });

  it('truncateUnit keeps the first dims and L2-normalizes', () => {
    expect(truncateUnit([3, 4, 99, 99], 2)).toEqual([0.6, 0.8]); // first 2 dims, unit length
    expect(norm(truncateUnit([1, 2, 3, 4], 3))).toBeCloseTo(1);
    expect(truncateUnit([0, 0, 0], 2)).toEqual([0, 0]); // zero vector stays zero (no NaN)
    expect(truncateUnit([3, 4], 8)).toEqual([0.6, 0.8]); // dims >= length normalizes whole
  });
});
