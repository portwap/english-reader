// Tests for the OpenRouter adapter with a fake network: answer parsing, retries and the fallback model.

import { describe, expect, it } from 'vitest';
import { buildPrompt, createOpenRouter, parseAnswer } from './openrouter.ts';

/** Builds an OpenRouter-style HTTP response with the given answer text. */
function answer(content: string, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), { status });
}

/** A fake fetch that returns the given responses in order and records which models were asked. */
function fakeFetch(...responses: Response[]) {
  const models: string[] = [];
  const fetch = (async (_url: string, init: RequestInit) => {
    models.push((JSON.parse(String(init.body)) as { model: string }).model);
    const next = responses.shift();
    if (!next) throw new Error('no more fake responses');
    return next;
  }) as unknown as typeof globalThis.fetch;
  return { fetch, models };
}

const GOOD = '{"translations":[{"n":1,"ru":"Привет."},{"n":2,"ru":"Пока."}]}';

describe('parseAnswer', () => {
  it('returns one translation per sentence in sentence order', () => {
    expect(parseAnswer('{"translations":[{"n":2,"ru":"Б"},{"n":1,"ru":"А"}]}', 2)).toEqual(['А', 'Б']);
  });

  it('reads JSON wrapped in a code block', () => {
    expect(parseAnswer('```json\n' + GOOD + '\n```', 2)).toEqual(['Привет.', 'Пока.']);
  });

  it('rejects an answer that misses a sentence', () => {
    expect(() => parseAnswer('{"translations":[{"n":1,"ru":"А"}]}', 2)).toThrow(/1 translations for 2 sentences/);
  });

  it('rejects an empty translation', () => {
    expect(() => parseAnswer('{"translations":[{"n":1,"ru":"А"},{"n":2,"ru":" "}]}', 2)).toThrow(/sentence 2/);
  });

  it('rejects a sentence translated twice', () => {
    expect(() => parseAnswer('{"translations":[{"n":1,"ru":"А"},{"n":1,"ru":"Б"}]}', 2)).toThrow(/twice/);
  });
});

describe('buildPrompt', () => {
  it('includes the whole text and every sentence with its number', () => {
    const prompt = buildPrompt('Hi. Bye.', ['Hi.', 'Bye.']);
    expect(prompt).toContain('Hi. Bye.');
    expect(prompt).toContain('1. Hi.\n2. Bye.');
  });
});

describe('createOpenRouter', () => {
  it('returns the translations and the model that made them', async () => {
    const { fetch } = fakeFetch(answer(GOOD));
    const translator = createOpenRouter({ apiKey: 'k', models: ['m1', 'm2'], fetch, retryDelayMs: 0 });
    expect(await translator.translate('Hi. Bye.', ['Hi.', 'Bye.'])).toEqual({
      translations: ['Привет.', 'Пока.'],
      model: 'm1',
    });
  });

  it('retries the same model once, then moves to the fallback model', async () => {
    const { fetch, models } = fakeFetch(answer('not json'), answer('', 500), answer(GOOD));
    const translator = createOpenRouter({ apiKey: 'k', models: ['m1', 'm2'], fetch, retryDelayMs: 0 });
    const result = await translator.translate('Hi. Bye.', ['Hi.', 'Bye.']);
    expect(models).toEqual(['m1', 'm1', 'm2']);
    expect(result.model).toBe('m2');
  });

  it('fails with every attempt listed when all models fail', async () => {
    const { fetch } = fakeFetch(answer('', 429), answer('', 429), answer('x'), answer('x'));
    const translator = createOpenRouter({ apiKey: 'k', models: ['m1', 'm2'], fetch, retryDelayMs: 0 });
    await expect(translator.translate('Hi. Bye.', ['Hi.', 'Bye.'])).rejects.toThrow(
      /m1 \(attempt 1\): HTTP 429.*m1 \(attempt 2\).*m2 \(attempt 1\).*m2 \(attempt 2\)/,
    );
  });

  it('treats a cut-off answer as a failure', async () => {
    const cut = new Response(JSON.stringify({ choices: [{ message: { content: GOOD }, finish_reason: 'length' }] }));
    const { fetch } = fakeFetch(cut, answer(GOOD));
    const translator = createOpenRouter({ apiKey: 'k', models: ['m1'], fetch, retryDelayMs: 0 });
    expect((await translator.translate('Hi. Bye.', ['Hi.', 'Bye.'])).translations).toHaveLength(2);
  });
});
