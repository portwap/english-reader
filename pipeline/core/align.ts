// Matches the words the voice spoke to their places in the original text.
// The voice returns words as written, in order; finding each one in the text gives it a position.

import type { TimedWord } from '../tts/provider.ts';

/** A spoken word with its place in the text. */
export interface AlignedWord extends TimedWord {
  /** Where the word starts and ends in the text (end is exclusive). */
  from: number;
  to: number;
}

/**
 * Makes curly quotes and apostrophes plain. Each replacement is one character for one,
 * so positions in the result are the same as in the original.
 * @param text Any text.
 * @returns The text with ‘ ’ turned into ' and “ ” into ".
 */
function plainQuotes(text: string): string {
  return text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
}

const HAS_WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * Shows a short piece of text around a position, for error messages.
 * @param text The whole text.
 * @param at Position to show.
 * @returns About 40 characters around the position, on one line.
 */
function near(text: string, at: number): string {
  return text.slice(Math.max(0, at - 20), at + 20).replace(/\s+/g, ' ');
}

/**
 * Finds every spoken word in the text, in order, and checks that no written word was left without a timing.
 * @param text The exact text that was voiced.
 * @param words Spoken words from the voice adapter, in order.
 * @returns The same words with their positions in the text.
 * @throws If a spoken word is not in the text, or a written word was not spoken.
 */
export function alignWords(text: string, words: TimedWord[]): AlignedWord[] {
  const plainText = plainQuotes(text);
  const aligned: AlignedWord[] = [];
  let cursor = 0;
  for (const word of words) {
    const from = plainText.indexOf(plainQuotes(word.text), cursor);
    if (from < 0) {
      throw new Error(`The voice spoke "${word.text}", but it was not found in the text after "${near(text, cursor)}".`);
    }
    // Letters or digits between two spoken words mean a written word got no timing.
    const skipped = text.slice(cursor, from);
    if (HAS_WORD_CHAR.test(skipped)) {
      throw new Error(`Text "${skipped.trim()}" was not spoken (before "${word.text}", near "${near(text, cursor)}").`);
    }
    const to = from + word.text.length;
    aligned.push({ ...word, from, to });
    cursor = to;
  }
  const rest = text.slice(cursor);
  if (HAS_WORD_CHAR.test(rest)) {
    throw new Error(`The end of the text was not spoken: "${near(rest, 0).trim()}".`);
  }
  return aligned;
}
