// The translation models a text can be translated with. Each names its provider, like the voices do,
// so another translation service can be added next to OpenRouter later.

/** A translation model that can be chosen for a text. */
export interface TranslationModelOption {
  /** Translation service, the same as Translator.id, for example 'openrouter'. */
  provider: string;
  /** The service's own model id. */
  id: string;
  /** Short human name for lists. */
  label: string;
}

/**
 * Every allowed model. The chosen one is tried first; if it fails, the others of the same provider follow
 * in this order, so a text is not left without a translation when one free model is down.
 * Chosen by the WMT24++ translation ranking (see docs/PLAN.md). Gemma comes before Nemotron 3 Ultra although
 * it ranks lower: Ultra runs at NVIDIA like Nemotron 3 Super, so when NVIDIA is slow, Gemma still gets its turn.
 */
export const TRANSLATION_MODELS: readonly TranslationModelOption[] = [
  { provider: 'openrouter', id: 'nvidia/nemotron-3-super-120b-a12b:free', label: 'NVIDIA Nemotron 3 Super' },
  { provider: 'openrouter', id: 'google/gemma-4-31b-it:free', label: 'Google Gemma 4 31B' },
  { provider: 'openrouter', id: 'nvidia/nemotron-3-ultra-550b-a55b:free', label: 'NVIDIA Nemotron 3 Ultra' },
];

/**
 * Gives one string that names a model together with its provider, for forms and the API.
 * @param model A model.
 * @returns A key such as "openrouter:google/gemma-4-31b-it:free".
 */
export function translationModelKey(model: { provider: string; id: string }): string {
  return `${model.provider}:${model.id}`;
}

/** The model chosen in the admin form until another one is picked. */
export const DEFAULT_TRANSLATION_MODEL = translationModelKey(TRANSLATION_MODELS[0] ?? { provider: '', id: '' });

/**
 * Finds an allowed model by its key.
 * @param key A key from translationModelKey.
 * @returns The model, or undefined if the key is not in TRANSLATION_MODELS.
 */
export function findTranslationModel(key: string): TranslationModelOption | undefined {
  return TRANSLATION_MODELS.find((model) => translationModelKey(model) === key);
}

/**
 * Lists the models to try for a text: the chosen one first, then the other models of the same provider.
 * @param provider Translation service.
 * @param preferred Id of the chosen model; an unknown or missing one just means "the list order".
 * @returns Model ids in the order to try.
 */
export function modelsToTry(provider: string, preferred: string | undefined): string[] {
  const ids = TRANSLATION_MODELS.filter((model) => model.provider === provider).map((model) => model.id);
  return preferred && ids.includes(preferred) ? [preferred, ...ids.filter((id) => id !== preferred)] : ids;
}

/**
 * Gives a model's human name.
 * @param id Model id.
 * @returns Its label, or the id itself for a model no longer in the list.
 */
export function translationModelLabel(id: string): string {
  return TRANSLATION_MODELS.find((model) => model.id === id)?.label ?? id;
}
