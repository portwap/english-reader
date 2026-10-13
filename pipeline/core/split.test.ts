// Tests for splitting a text into paragraphs and sentences with exact positions.

import { describe, expect, it } from 'vitest';
import { normalizeSource, splitSentences } from './split.ts';

describe('normalizeSource', () => {
  it('turns Windows and old Mac line endings into \\n and trims the text', () => {
    expect(normalizeSource('  One.\r\nTwo.\rThree.  \n')).toBe('One.\nTwo.\nThree.');
  });
});

describe('splitSentences', () => {
  it('finds sentences with positions that point back to the exact text', () => {
    const text = 'It rains. "Stay home," she said! Why?';
    const sentences = splitSentences(text);
    expect(sentences.map((s) => s.text)).toEqual(['It rains.', '"Stay home," she said!', 'Why?']);
    for (const s of sentences) expect(text.slice(s.from, s.to)).toBe(s.text);
  });

  it('numbers paragraphs by lines and skips empty lines', () => {
    const text = 'First one. Second one.\n\nNew paragraph.\nThird paragraph.';
    const sentences = splitSentences(text);
    expect(sentences.map((s) => [s.text, s.paragraph])).toEqual([
      ['First one.', 0],
      ['Second one.', 0],
      ['New paragraph.', 1],
      ['Third paragraph.', 2],
    ]);
    for (const s of sentences) expect(text.slice(s.from, s.to)).toBe(s.text);
  });

  it('keeps numbers with points and commas inside one sentence', () => {
    const sentences = splitSentences('It costs 3.50 dollars. He waited 1,200 days.');
    expect(sentences.map((s) => s.text)).toEqual(['It costs 3.50 dollars.', 'He waited 1,200 days.']);
  });
});
