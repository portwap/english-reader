// Tests for the text page helpers: finding the sounding word and cutting sentences into parts.

import { describe, expect, it } from 'vitest';
import type { DocSentence } from '../../shared/text-doc.ts';
import { sentenceParts, wordIndexAt, wordRange } from './timeline.ts';

const sentence: DocSentence = {
  text: '"Well, they can.',
  translation: '«Ну, они могут.',
  paragraph: 0,
  start: 1,
  end: 2.2,
  words: [
    { text: 'Well', start: 1, end: 1.4, at: 1 },
    { text: 'they', start: 1.5, end: 1.8, at: 7 },
    { text: 'can', start: 1.8, end: 2.2, at: 12 },
  ],
};

describe('wordIndexAt', () => {
  it('finds the word sounding at a moment', () => {
    expect(wordIndexAt(sentence.words, 1.2)).toBe(0);
    expect(wordIndexAt(sentence.words, 1.8)).toBe(2);
  });

  it('returns -1 between words and outside the audio', () => {
    expect(wordIndexAt(sentence.words, 1.45)).toBe(-1);
    expect(wordIndexAt(sentence.words, 0.5)).toBe(-1);
    expect(wordIndexAt(sentence.words, 9)).toBe(-1);
    expect(wordIndexAt([], 1)).toBe(-1);
  });
});

describe('sentenceParts', () => {
  it('keeps every character and marks the spoken words', () => {
    const parts = sentenceParts(sentence);
    expect(parts.map((part) => part.text).join('')).toBe(sentence.text);
    expect(parts.map((part) => [part.text, Boolean(part.word)])).toEqual([
      ['"', false],
      ['Well', true],
      [', ', false],
      ['they', true],
      [' ', false],
      ['can', true],
      ['.', false],
    ]);
  });
});

describe('wordRange', () => {
  it('adds padding around a word but stays inside the audio', () => {
    expect(wordRange({ text: 'a', start: 1, end: 1.5, at: 0 }, 10)).toEqual({ from: 0.96, to: 1.54 });
    expect(wordRange({ text: 'a', start: 0.01, end: 9.99, at: 0 }, 10)).toEqual({ from: 0, to: 10 });
  });
});
