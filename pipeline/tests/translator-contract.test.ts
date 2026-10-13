// Contract tests for translation adapters: exactly one non-empty translation per sentence.
// Every translation adapter must pass the same rules before a text can be ready.

import { describe, expect, it } from 'vitest';
import { checkTranslations } from '../core/checks.ts';
import { createOpenRouter } from '../translate/openrouter.ts';

const SENTENCES = ['It rains.', 'Stay home.', 'Why?'];

describe('translation adapter contract (OpenRouter with a fake network)', () => {
  it('returns exactly one non-empty translation per sentence', async () => {
    const content = JSON.stringify({ translations: SENTENCES.map((_, i) => ({ n: i + 1, ru: `Перевод ${i + 1}` })) });
    const fetch = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }))) as unknown as
      typeof globalThis.fetch;
    const { translations } = await createOpenRouter({ apiKey: 'k', models: ['m'], fetch }).translate(
      SENTENCES.join(' '),
      SENTENCES,
    );
    expect(checkTranslations(SENTENCES, translations)).toEqual([]);
  });

  it('reports a missing or empty translation', () => {
    expect(checkTranslations(SENTENCES, ['А', ''])).toEqual(['2 translations for 3 sentences', 'translation #2 is empty']);
  });
});
