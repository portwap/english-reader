// Tests for the list of translation models: keys, lookup, labels, and the order models are tried in.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRANSLATION_MODEL,
  findTranslationModel,
  modelsToTry,
  TRANSLATION_MODELS,
  translationModelKey,
  translationModelLabel,
} from './translation-models.ts';

const nemotron = 'nvidia/nemotron-3-super-120b-a12b:free';
const gemma = 'google/gemma-4-31b-it:free';

describe('translation models', () => {
  it('names a model together with its provider and finds it by that key', () => {
    expect(translationModelKey({ provider: 'openrouter', id: gemma })).toBe(`openrouter:${gemma}`);
    expect(findTranslationModel(`openrouter:${gemma}`)?.label).toBe('Google Gemma 4 31B');
    expect(findTranslationModel(gemma)).toBeUndefined();
  });

  it('has the default model in the list and no model twice', () => {
    expect(findTranslationModel(DEFAULT_TRANSLATION_MODEL)).toBeDefined();
    const keys = TRANSLATION_MODELS.map(translationModelKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('tries the chosen model first, then the others as fallbacks', () => {
    expect(modelsToTry('openrouter', gemma)).toEqual([gemma, nemotron]);
    expect(modelsToTry('openrouter', nemotron)).toEqual([nemotron, gemma]);
  });

  it('falls back to the list order for an unknown or missing choice, and to nothing for an unknown provider', () => {
    expect(modelsToTry('openrouter', 'gone/model')).toEqual([nemotron, gemma]);
    expect(modelsToTry('openrouter', undefined)).toEqual([nemotron, gemma]);
    expect(modelsToTry('other', gemma)).toEqual([]);
  });

  it('shows a human name, or the id of a model no longer in the list', () => {
    expect(translationModelLabel(nemotron)).toBe('NVIDIA Nemotron 3 Super');
    expect(translationModelLabel('old/model')).toBe('old/model');
  });
});
