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

/**
 * Brings line endings to "\n" and trims the text, so positions are stable
 * no matter where the text was pasted from.
 * @param text Text as pasted.
 * @returns The same text with "\n" line endings and no spaces at the ends.
 */
export function normalizeSource(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim();
}

const sentenceSegmenter = new Intl.Segmenter('en', { granularity: 'sentence' });

/**
 * Splits a normalized text into sentences. Each line is a paragraph, like Kokoro reads it;
 * empty lines only separate paragraphs.
 * @param text Text from normalizeSource.
 * @returns Sentences in order, with paragraph numbers and positions.
 */
export function splitSentences(text: string): SourceSentence[] {
  const sentences: SourceSentence[] = [];
  let paragraph = 0;
  let lineStart = 0;
  for (const line of text.split('\n')) {
    if (line.trim()) {
      for (const segment of sentenceSegmenter.segment(line)) {
        const trimmed = segment.segment.trim();
        if (!trimmed) continue;
        const from = lineStart + segment.index + segment.segment.indexOf(trimmed);
        sentences.push({ text: trimmed, paragraph, from, to: from + trimmed.length });
      }
      paragraph++;
    }
    lineStart += line.length + 1;
  }
  return sentences;
}
