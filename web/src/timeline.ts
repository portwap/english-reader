// Pure helpers for the text page: which word sounds at a moment, and how to cut a sentence into words and gaps.
// Kept free of the DOM so they can be tested directly.

import type { DocSentence, DocWord } from '../../shared/text-doc.ts';

/**
 * Finds the word sounding at a moment.
 * @param words Words in time order.
 * @param time Seconds from the start of the audio.
 * @returns Index of the word, or -1 between words and outside the audio.
 */
export function wordIndexAt(words: readonly DocWord[], time: number): number {
  let low = 0;
  let high = words.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if ((words[middle]?.start ?? Infinity) <= time) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found >= 0 && time < (words[found]?.end ?? 0) ? found : -1;
}

/** A piece of a sentence: either a spoken word or the text between words. */
export type SentencePart = { text: string; word: DocWord } | { text: string; word?: undefined };

/**
 * Cuts a sentence into words and the text around them, keeping every character.
 * @param sentence A sentence whose words carry their position (at) in its text.
 * @returns Parts in order; joined together they give the sentence text exactly.
 */
export function sentenceParts(sentence: DocSentence): SentencePart[] {
  const parts: SentencePart[] = [];
  let cursor = 0;
  for (const word of sentence.words) {
    if (word.at > cursor) parts.push({ text: sentence.text.slice(cursor, word.at) });
    parts.push({ text: sentence.text.slice(word.at, word.at + word.text.length), word });
    cursor = word.at + word.text.length;
  }
  if (cursor < sentence.text.length) parts.push({ text: sentence.text.slice(cursor) });
  return parts;
}

/** Extra sound around a single word, in seconds, so its first and last sounds are not cut off. */
export const WORD_PADDING = 0.04;

/**
 * Gives the part of the audio to play for one word, with padding, kept inside the audio.
 * @param word The word.
 * @param duration Audio length in seconds.
 * @returns Start and end in seconds.
 */
export function wordRange(word: DocWord, duration: number): { from: number; to: number } {
  return { from: Math.max(0, word.start - WORD_PADDING), to: Math.min(duration, word.end + WORD_PADDING) };
}
