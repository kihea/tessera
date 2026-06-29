import { describe, it, expect } from 'vitest';
import { cosine } from '../ai/vec';
import { quantizeVector, dequantizeVector, isQuantizedVector } from './quantize';

describe('quantize', () => {
  it('round-trips a vector with tiny error (cosine ~ 1, length preserved)', () => {
    const v = Array.from({ length: 64 }, (_, i) => Math.sin(i) * (i % 7) - 0.5);
    const q = quantizeVector(v);
    const back = dequantizeVector(q);
    expect(back.length).toBe(v.length);
    expect(cosine(v, back)).toBeGreaterThan(0.999);
  });

  it('preserves a length not divisible by 3 (base64 padding paths)', () => {
    for (const n of [1, 2, 4, 5, 7, 100]) {
      const v = Array.from({ length: n }, (_, i) => (i - n / 2) / n);
      const back = dequantizeVector(quantizeVector(v));
      expect(back.length).toBe(n);
    }
  });

  it('handles a zero vector without NaNs', () => {
    const back = dequantizeVector(quantizeVector([0, 0, 0, 0]));
    expect(back).toEqual([0, 0, 0, 0]);
  });

  it('isQuantizedVector distinguishes encoded vectors from plain arrays', () => {
    expect(isQuantizedVector(quantizeVector([1, 2, 3]))).toBe(true);
    expect(isQuantizedVector([1, 2, 3])).toBe(false);
    expect(isQuantizedVector(undefined)).toBe(false);
    expect(isQuantizedVector({ q: 'x' })).toBe(false);
  });
});
