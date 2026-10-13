// Checks that adapter results are usable: the same rules run in the contract tests and on every real text.
// A result that fails them is never saved as ready.

import type { TimedWord } from '../tts/provider.ts';

/**
 * Checks that word timings can drive a highlight: each word has a real span,
 * words go in order, and none runs past the end of the audio.
 * @param words Timed words from a voice adapter.
 * @param duration Audio length in seconds.
 * @returns A list of problems; empty when all is well.
 */
export function checkTimings(words: TimedWord[], duration: number): string[] {
  const problems: string[] = [];
  if (words.length === 0) problems.push('no timed words');
  let previousStart = 0;
  for (const [i, word] of words.entries()) {
    if (!(word.end > word.start)) problems.push(`word #${i} "${word.text}" ends before it starts`);
    if (word.start < previousStart) problems.push(`word #${i} "${word.text}" starts before the previous word`);
    // A few milliseconds of rounding is fine; more means the timing is wrong.
    if (word.end > duration + 0.05) problems.push(`word #${i} "${word.text}" ends after the audio`);
    previousStart = word.start;
  }
  return problems;
}

/**
 * Checks that there is exactly one non-empty translation per sentence.
 * @param sentences Sentences that were sent for translation.
 * @param translations What came back.
 * @returns A list of problems; empty when all is well.
 */
export function checkTranslations(sentences: string[], translations: string[]): string[] {
  const problems: string[] = [];
  if (translations.length !== sentences.length) {
    problems.push(`${translations.length} translations for ${sentences.length} sentences`);
  }
  for (const [i, translation] of translations.entries()) {
    if (typeof translation !== 'string' || !translation.trim()) problems.push(`translation #${i + 1} is empty`);
  }
  return problems;
}
