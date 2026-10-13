// Tests for matching spoken words to their places in the text.

import { describe, expect, it } from 'vitest';
import type { TimedWord } from '../tts/provider.ts';
import { alignWords } from './align.ts';

/** Makes timed words with simple one-second steps; only the text matters here. */
function spoken(...texts: string[]): TimedWord[] {
  return texts.map((text, i) => ({ text, start: i, end: i + 0.9 }));
}

describe('alignWords', () => {
  it('gives each spoken word its exact place in the text', () => {
    const text = 'At 7:45, it\'s about twenty-five minutes — 1,200 days!';
    const words = alignWords(text, spoken('At', '7:45', "it's", 'about', 'twenty-five', 'minutes', '1,200', 'days'));
    for (const word of words) expect(text.slice(word.from, word.to)).toBe(word.text);
    expect(words.map((w) => w.from)).toEqual([0, 3, 9, 14, 20, 32, 42, 48]);
  });

  it('matches plain quotes from the voice to curly quotes in the text', () => {
    const text = 'She doesn’t know.';
    const words = alignWords(text, spoken('She', "doesn't", 'know'));
    expect(words[1]).toMatchObject({ from: 4, to: 11 });
  });

  it('fails with the missing text when a written word was not spoken', () => {
    expect(() => alignWords('One two three.', spoken('One', 'three'))).toThrow(/"two" was not spoken/);
  });

  it('fails when a spoken word is not in the text', () => {
    expect(() => alignWords('One two.', spoken('One', 'four'))).toThrow(/spoke "four"/);
  });

  it('fails when the end of the text was not spoken', () => {
    expect(() => alignWords('One two.', spoken('One'))).toThrow(/end of the text was not spoken/);
  });
});
