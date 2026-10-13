// Pure helpers for the text page: which word sounds at a moment, how to cut a sentence into words and gaps,
// and which part of the audio belongs to a sentence. Kept free of the DOM so they can be tested directly.

import type { DocSentence, DocWord } from '../../shared/text-doc.ts';

/**
 * Finds the last word that has started by a moment.
 * @param words Words in time order.
 * @param time Seconds from the start of the audio.
 * @returns Index of the word, or -1 before the first word.
 */
export function lastWordStarted(words: readonly DocWord[], time: number): number {
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
  return found;
}

/**
 * Finds the word sounding at a moment.
 * @param words Words in time order.
 * @param time Seconds from the start of the audio.
 * @returns Index of the word, or -1 between words and outside the audio.
 */
export function wordIndexAt(words: readonly DocWord[], time: number): number {
  const found = lastWordStarted(words, time);
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

/** Most extra sound taken before and after a sentence, in seconds. */
export const SENTENCE_PADDING = 0.15;

/**
 * Gives the part of the audio to play for one sentence. Word timings can be a little early or late,
 * so a short margin is added on each side, but never past the middle of the pause to the next sentence.
 * @param sentences All sentences in order.
 * @param index Which sentence.
 * @param duration Audio length in seconds.
 * @returns Start and end in seconds.
 */
export function sentenceRange(
  sentences: readonly DocSentence[],
  index: number,
  duration: number,
): { from: number; to: number } {
  const sentence = sentences[index];
  if (!sentence) return { from: 0, to: 0 };
  const previous = sentences[index - 1];
  const next = sentences[index + 1];
  const earliest = previous ? (previous.end + sentence.start) / 2 : 0;
  const latest = next ? (sentence.end + next.start) / 2 : duration;
  return {
    from: Math.max(earliest, sentence.start - SENTENCE_PADDING),
    to: Math.min(latest, sentence.end + SENTENCE_PADDING),
  };
}
