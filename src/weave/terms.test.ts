import { describe, it, expect } from 'vitest';
import { isAdjectiveHeaded, isGenericTerm, normalizeTerm } from './terms';

describe('normalizeTerm', () => {
  it('folds simple plurals to singular', () => {
    expect(normalizeTerm('models')).toBe('model');
    expect(normalizeTerm('cells')).toBe('cell');
  });
  it('folds -sses style plurals', () => {
    expect(normalizeTerm('presses')).toBe('press');
  });
  it('leaves -ss and -us words alone', () => {
    expect(normalizeTerm('glass')).toBe('glass');
    expect(normalizeTerm('virus')).toBe('virus');
  });
  it('folds each word of a bigram', () => {
    expect(normalizeTerm('neural networks')).toBe('neural network');
  });
});

describe('isAdjectiveHeaded', () => {
  it('flags a bare adjective from the lexicon', () => {
    expect(isAdjectiveHeaded('ancient')).toBe(true);
    expect(isAdjectiveHeaded('political')).toBe(true);
  });
  it('flags -ous / -ful / -less suffixes', () => {
    expect(isAdjectiveHeaded('dangerous')).toBe(true);
    expect(isAdjectiveHeaded('useless')).toBe(true);
  });
  it('treats noun-headed phrases as nominal', () => {
    expect(isAdjectiveHeaded('ancient schools')).toBe(false);
    expect(isAdjectiveHeaded('empire')).toBe(false);
  });
});

describe('isGenericTerm', () => {
  it('flags documented filler unigrams', () => {
    expect(isGenericTerm('level')).toBe(true);
  });
  it('never flags multi-word terms', () => {
    expect(isGenericTerm('machine learning')).toBe(false);
  });
});
