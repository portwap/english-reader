// The translation interface: what every translation adapter must provide.
// The rest of the pipeline uses only this, so a translation service can be swapped by adding one adapter.

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
   * @returns One translation per sentence and the model used.
   */
  translate(fullText: string, sentences: string[]): Promise<TranslationResult>;
}
