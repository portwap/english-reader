// Picks the translation adapter from the TRANSLATOR setting.
// To add a translation service: write its adapter and add a branch here.

import { createOpenRouter, parseModels } from './openrouter.ts';
import type { Translator } from './translator.ts';

/**
 * Creates the translator named by the settings.
 * @param env Settings: TRANSLATOR (default "openrouter") and that service's own settings.
 * @returns The translator.
 * @throws If the service is unknown or its key is missing.
 */
export function createTranslator(env: Record<string, string | undefined>): Translator {
  const name = env.TRANSLATOR?.trim() || 'openrouter';
  if (name === 'openrouter') {
    const apiKey = env.OPENROUTER_API_KEY?.trim();
    if (!apiKey) throw new Error('The setting OPENROUTER_API_KEY is missing.');
    return createOpenRouter({ apiKey, models: parseModels(env.TRANSLATION_MODELS) });
  }
  throw new Error(`Unknown translator "${name}".`);
}
