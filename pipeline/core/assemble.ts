// Builds the sentences of a text document from the split text, the aligned words and the translations.
// This is where the pieces from the voice and the translator come together in the data contract format.

import type { DocSentence } from '../../shared/text-doc.ts';
import type { AlignedWord } from './align.ts';
import type { SourceSentence } from './split.ts';

/** Rounds seconds to milliseconds, enough for highlighting and slicing. */
function ms(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}

/**
 * Puts each aligned word into its sentence and adds the translations.
 * @param sentences Sentences from splitSentences.
 * @param words Words from alignWords, positioned in the same text.
 * @param translations One translation per sentence, in the same order.
 * @returns Sentences in the data contract format.
 * @throws If the number of translations differs from the number of sentences.
 */
export function assembleSentences(
  sentences: SourceSentence[],
  words: AlignedWord[],
  translations: string[],
): DocSentence[] {
  if (translations.length !== sentences.length) {
    throw new Error(`Got ${translations.length} translations for ${sentences.length} sentences.`);
  }
  const result: DocSentence[] = sentences.map((sentence, i) => ({
    text: sentence.text,
    translation: translations[i] ?? '',
    paragraph: sentence.paragraph,
    start: 0,
    end: 0,
    words: [],
  }));

  let s = 0;
  for (const word of words) {
    // Words and sentences are both in text order, so the matching sentence is never behind.
    while (s < sentences.length - 1 && word.from >= (sentences[s]?.to ?? 0)) s++;
    const sentence = sentences[s];
    const target = result[s];
    if (!sentence || !target) break;
    target.words.push({ text: word.text, start: ms(word.start), end: ms(word.end), at: word.from - sentence.from });
  }

  // A sentence with no spoken words (only symbols) takes the time where the previous one ended.
  let lastEnd = 0;
  for (const sentence of result) {
    const first = sentence.words[0];
    const last = sentence.words[sentence.words.length - 1];
    sentence.start = first ? first.start : lastEnd;
    sentence.end = last ? last.end : lastEnd;
    lastEnd = sentence.end;
  }
  return result;
}
