// Creates the translation adapter for a text: its provider, with the chosen model tried first.
// To add a translation service: write its adapter, add a branch here, and add its models to shared/translation-models.ts.

import { modelsToTry } from '../../shared/translation-models.ts';
import { createOpenRouter } from './openrouter.ts';
import type { Translator } from './translator.ts';

/**
 * Creates the translator for one text.
 * @param provider Translation service saved with the text, for example "openrouter"; empty means "openrouter".
 * @param preferred Id of the model the admin chose; the others of the same service are fallbacks.
 * @param env Secrets of the services, for example OPENROUTER_API_KEY.
 * @returns The translator.
 * @throws If the service is unknown, has no models, or its key is missing.
 */
export function createTranslator(
  provider: string,
  preferred: string | undefined,
  env: Record<string, string | undefined>,
): Translator {
  // Texts saved before models could be chosen have no provider yet; they were translated by OpenRouter.
  const service = provider || 'openrouter';
  const models = modelsToTry(service, preferred);
  if (models.length === 0) throw new Error(`No translation models for "${service}".`);
  if (service === 'openrouter') {
    const apiKey = env.OPENROUTER_API_KEY?.trim();
    if (!apiKey) throw new Error('The setting OPENROUTER_API_KEY is missing.');
    return createOpenRouter({ apiKey, models });
  }
  throw new Error(`Unknown translation service "${service}".`);
}
