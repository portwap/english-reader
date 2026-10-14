// Tests for creating the translator of a text from its provider and chosen model.

import { describe, expect, it } from 'vitest';
import { createTranslator } from './translators.ts';

describe('createTranslator', () => {
  it('creates the OpenRouter translator, also for texts saved before models could be chosen', () => {
    expect(createTranslator('openrouter', 'google/gemma-4-31b-it:free', { OPENROUTER_API_KEY: 'k' }).id).toBe('openrouter');
    expect(createTranslator('', undefined, { OPENROUTER_API_KEY: 'k' }).id).toBe('openrouter');
  });

  it('fails clearly without the key or for an unknown service', () => {
    expect(() => createTranslator('openrouter', undefined, {})).toThrow(/OPENROUTER_API_KEY is missing/);
    expect(() => createTranslator('other', undefined, { OPENROUTER_API_KEY: 'k' })).toThrow(/No translation models for "other"/);
  });
});
