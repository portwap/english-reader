// Splits a text into paragraphs and sentences, keeping each sentence's place in the original text.
// Positions matter: spoken words are later matched to sentences by where they sit in the text.

/** A sentence found in the text. */
export interface SourceSentence {
  /** The sentence as written, without surrounding spaces. */
  text: string;
  /** Number of the paragraph, from 0. */
  paragraph: number;
  /** Where the sentence starts and ends in the normalized text (end is exclusive). */
  from: number;
  to: number;
}

export { normalizeSource } from '../../shared/new-text.ts';

const sentenceSegmenter = new Intl.Segmenter('en', { granularity: 'sentence' });

/**
 * A piece that goes on the sentence before it: its first letter is small, as in a speech tag after a quoted
 * question or exclamation ("Why?" asked Tom.), which the segmenter cuts off as a sentence of its own.
 * A piece starting with a digit is not joined: "3 people came." is a sentence.
 */
const CONTINUATION = /^[\p{P}\s]*\p{Ll}/u;

/**
 * Splits a normalized text into sentences. Each line is a paragraph, like Kokoro reads it;
 * empty lines only separate paragraphs. A speech tag stays with its quote: “Why?” asked Tom. is one sentence.
 * @param text Text from normalizeSource.
 * @returns Sentences in order, with paragraph numbers and positions.
 */
export function splitSentences(text: string): SourceSentence[] {
  const sentences: SourceSentence[] = [];
  let paragraph = 0;
  let lineStart = 0;
  for (const line of text.split('\n')) {
    if (line.trim()) {
      const firstInLine = sentences.length;
      for (const segment of sentenceSegmenter.segment(line)) {
        const trimmed = segment.segment.trim();
        if (!trimmed) continue;
        const from = lineStart + segment.index + segment.segment.indexOf(trimmed);
        const to = from + trimmed.length;
        // Only a sentence of the same paragraph can be continued.
        const previous = sentences.length > firstInLine ? sentences[sentences.length - 1] : undefined;
        if (previous && CONTINUATION.test(trimmed)) {
          previous.text = text.slice(previous.from, to);
          previous.to = to;
        } else {
          sentences.push({ text: trimmed, paragraph, from, to });
        }
      }
      paragraph++;
    }
    lineStart += line.length + 1;
  }
  return sentences;
}
