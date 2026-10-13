// Tests for the text page helpers: finding words by time, cutting sentences into parts,
// and the audio range of a sentence.

import { describe, expect, it } from 'vitest';
import type { DocSentence } from '../../shared/text-doc.ts';
import { lastWordStarted, sentenceParts, sentenceRange, wordIndexAt } from './timeline.ts';

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

describe('lastWordStarted', () => {
  it('finds the last word that has started, also between words and after the end', () => {
    expect(lastWordStarted(sentence.words, 1.45)).toBe(0);
    expect(lastWordStarted(sentence.words, 9)).toBe(2);
    expect(lastWordStarted(sentence.words, 0.5)).toBe(-1);
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

describe('sentenceRange', () => {
  /** Makes a sentence that sounds from start to end; only the times matter here. */
  const timed = (start: number, end: number): DocSentence => ({ ...sentence, start, end });

  it('adds a margin on both sides when the pauses are long', () => {
    const range = sentenceRange([timed(0, 1), timed(2, 3), timed(4, 5)], 1, 6);
    expect(range.from).toBeCloseTo(1.85);
    expect(range.to).toBeCloseTo(3.15);
  });

  it('never reaches past the middle of a short pause to the next or previous sentence', () => {
    expect(sentenceRange([timed(0, 1), timed(1.1, 2), timed(2.04, 3)], 1, 4)).toEqual({ from: 1.05, to: 2.02 });
  });

  it('stays inside the audio at the start and the end', () => {
    expect(sentenceRange([timed(0.05, 1)], 0, 1.1)).toEqual({ from: 0, to: 1.1 });
  });
});
