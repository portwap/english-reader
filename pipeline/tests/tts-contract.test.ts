// Contract tests for voice adapters, run on real Kokoro output saved from the stage 1 voice check.
// Every voice adapter's output must pass the same rules before a text can be ready.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { alignWords } from '../core/align.ts';
import { checkTimings } from '../core/checks.ts';
import { normalizeSource } from '../core/split.ts';
import type { TimedWord } from '../tts/provider.ts';

/** Saved output of kokoro_tts.py for pipeline/samples/sample.txt with the am_liam voice. */
const kokoroOutput = JSON.parse(readFileSync(new URL('fixtures/kokoro-am_liam.json', import.meta.url), 'utf8')) as {
  text: string;
  duration: number;
  words: TimedWord[];
};

describe('voice adapter contract (Kokoro sample)', () => {
  it('has word timings that go up and stay within the audio length', () => {
    expect(checkTimings(kokoroOutput.words, kokoroOutput.duration)).toEqual([]);
  });

  it('matches every word of the text to a word from the voice output', () => {
    const text = normalizeSource(kokoroOutput.text);
    const words = alignWords(text, kokoroOutput.words);
    expect(words).toHaveLength(kokoroOutput.words.length);
    for (const word of words) expect(text.slice(word.from, word.to)).toBe(word.text);
  });

  it('reports timings that run backwards or past the audio', () => {
    const broken: TimedWord[] = [
      { text: 'a', start: 1, end: 1.5 },
      { text: 'b', start: 0.5, end: 0.4 },
      { text: 'c', start: 2, end: 99 },
    ];
    expect(checkTimings(broken, 3)).toHaveLength(3);
  });
});
