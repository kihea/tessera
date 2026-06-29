import { describe, it, expect } from 'vitest';
import { extractDates, eraOf, mergeEras, isChronological, formatYear } from './chronology';

const years = (t: string) => extractDates(t).map((d) => d.year);

describe('chronology', () => {
  it('reads year ranges, BC, centuries, and plain years', () => {
    expect(years('World War II (1939–1945) reshaped the world.')).toEqual([1939, 1945]);
    expect(years('Caesar was assassinated in 44 BC.')).toEqual([-44]);
    expect(years('The 5th century BC saw the rise of Athens.')).toEqual([-450]);
    expect(years('The 15th century opened the Renaissance.')).toEqual([1450]);
    expect(years('Apollo 11 landed in 1969.')).toEqual([1969]);
  });

  it('ignores non-year numbers and out-of-range values', () => {
    expect(years('It weighed 42 kilograms and cost 7 dollars.')).toEqual([]);
  });

  it('eraOf spans first..last; null when undated', () => {
    expect(eraOf('From 1789 through the 1799 coup.')).toEqual({ start: 1789, end: 1799 });
    expect(eraOf('No dates in this sentence at all.')).toBeNull();
  });

  it('mergeEras encloses all spans', () => {
    expect(mergeEras([{ start: 1789, end: 1799 }, null, { start: 1804, end: 1815 }])).toEqual({
      start: 1789,
      end: 1815,
    });
    expect(mergeEras([null, null])).toBeNull();
  });

  it('isChronological: person/event always; topics need dated + spanning', () => {
    expect(isChronological({ qType: 'person' })).toBe(true);
    expect(isChronological({ qType: 'event' })).toBe(true);
    expect(isChronological({ qType: 'topic', datedFraction: 0.1, spanYears: 200 })).toBe(false);
    expect(isChronological({ qType: 'topic', datedFraction: 0.5, spanYears: 5 })).toBe(false);
    expect(isChronological({ qType: 'topic', datedFraction: 0.5, spanYears: 200 })).toBe(true);
  });

  it('formatYear labels BC and AD', () => {
    expect(formatYear(-44)).toBe('44 BC');
    expect(formatYear(1939)).toBe('1939');
  });
});
