// The translation interface: what every translation adapter must provide.
// The rest of the pipeline uses only this, so a translation service can be swapped by adding one adapter.

import type { ProcessStep } from '../../shared/text-doc.ts';

/** A step of the translation the adapter reports as it happens; the time is added by the caller. */
export type TranslationEvent = Extract<ProcessStep, { type: 'attempt' | 'failed' }>;

/** Extra settings for one translation. */
export interface TranslateOptions {
  /** Groups the requests of one text at the service, for example the text id. */
  sessionId?: string;
  /** Called on every attempt and every failure, so the admin can follow the run. */
  onEvent?: (event: TranslationEvent) => void;
}

/** What an adapter returns for one text. */
export interface TranslationResult {
  /** One Russian translation per sentence, in the same order. */
  translations: string[];
  /** The model that made the translations, saved with the text. */
  model: string;
}

/** A translation service, such as OpenRouter. */
export interface Translator {
  /** Short name of the service, saved with each text, for example 'openrouter'. */
  id: string;
  /**
   * Translates the sentences of a text into Russian, using the whole text as context.
   * @param fullText The whole English text.
   * @param sentences The sentences of that text, in order.
   * @param options Session id and progress reports.
   * @returns One translation per sentence and the model used.
   */
  translate(fullText: string, sentences: string[], options?: TranslateOptions): Promise<TranslationResult>;
}
