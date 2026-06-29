import { describe, it, expect } from 'vitest';
import { classifyQuery } from './classify';
import type { Passage, SourceDoc } from '../types';

function lead(text: string): { passages: Passage[]; docs: Map<string, SourceDoc> } {
  const doc: SourceDoc = {
    id: 'd1',
    provider: 'Wikipedia',
    sourceType: 'encyclopedia',
    title: 't',
    url: 'u',
  };
  const passages: Passage[] = [{ id: 'p1', docId: 'd1', text, index: 0 }];
  return { passages, docs: new Map([['d1', doc]]) };
}

describe('classifyQuery', () => {
  it('detects a person from the encyclopedic lead', () => {
    const { passages, docs } = lead(
      'Marie Curie was a physicist and chemist who conducted pioneering research on radioactivity.',
    );
    expect(classifyQuery('Marie Curie', passages, docs)).toBe('person');
  });

  it('detects an event', () => {
    const { passages, docs } = lead(
      'World War II was a global war that lasted from 1939 to 1945, involving most of the world.',
    );
    expect(classifyQuery('World War II', passages, docs)).toBe('event');
  });

  it('detects a philosophy from an -ism query', () => {
    const { passages, docs } = lead('Stoicism is a school of thought and Hellenistic philosophy.');
    expect(classifyQuery('stoicism', passages, docs)).toBe('philosophy');
  });

  it('falls back to topic for a plain subject', () => {
    const { passages, docs } = lead(
      'Photosynthesis is the process plants use to convert light energy into chemical energy.',
    );
    expect(classifyQuery('photosynthesis', passages, docs)).toBe('topic');
  });
});
