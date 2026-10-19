// Tests for the OpenRouter adapter with a fake network: answer parsing, retries, fallback models and time limits.

import { describe, expect, it } from 'vitest';
import { buildPrompt, createOpenRouter, parseAnswer } from './openrouter.ts';
import type { TranslationEvent } from './translator.ts';

/** Builds an OpenRouter-style HTTP response with the given answer text. */
function answer(content: string, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), { status });
}

/** Stands for a model that never answers: the request waits until its time limit aborts it. */
const HANG = 'hang';

/** A fake fetch that returns the given responses in order and records each request body. */
function fakeFetch(...responses: (Response | typeof HANG)[]) {
  const bodies: { model: string; session_id?: string }[] = [];
  const fetch = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)) as { model: string; session_id?: string });
    const next = responses.shift();
    if (!next) throw new Error('no more fake responses');
    if (next === HANG) {
      return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason)));
    }
    return next;
  }) as unknown as typeof globalThis.fetch;
  return { fetch, bodies, models: () => bodies.map((body) => body.model) };
}

/** Collects the events a translation reports. */
function eventsOf() {
  const events: TranslationEvent[] = [];
  return { events, onEvent: (event: TranslationEvent) => void events.push(event) };
}

/** Shortens failure events to what the tests compare: model, attempt, reason and what came next. */
function failures(events: TranslationEvent[]): string[] {
  return events.flatMap((e) => (e.type === 'failed' ? [`${e.model}#${e.attempt} ${e.reason} -> ${e.then}`] : []));
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
  const sentences = ['Hi.', 'Bye.'];

  it('returns the translations and the model that made them, and names the text to OpenRouter', async () => {
    const { fetch, bodies } = fakeFetch(answer(GOOD));
    const translator = createOpenRouter({ apiKey: 'k', models: ['m1', 'm2'], fetch, retryDelayMs: 0 });
    expect(await translator.translate('Hi. Bye.', sentences, { sessionId: 'anna-1' })).toEqual({
      translations: ['Привет.', 'Пока.'],
      model: 'm1',
    });
    expect(bodies[0]?.session_id).toBe('anna-1');
  });

  it('retries the same model once after a broken answer or a server error, then moves to the next model', async () => {
    const { fetch, models } = fakeFetch(answer('not json'), answer('', 500), answer(GOOD));
    const { events, onEvent } = eventsOf();
    const translator = createOpenRouter({ apiKey: 'k', models: ['m1', 'm2'], fetch, retryDelayMs: 0 });
    const result = await translator.translate('Hi. Bye.', sentences, { onEvent });
    expect(models()).toEqual(['m1', 'm1', 'm2']);
    expect(result.model).toBe('m2');
    expect(failures(events)).toEqual(['m1#1 bad-answer -> retry', 'm1#2 server -> next-model']);
    expect(events.filter((e) => e.type === 'attempt').map((e) => `${e.model}#${e.attempt}`)).toEqual([
      'm1#1',
      'm1#2',
      'm2#1',
    ]);
  });

  it('moves to the next model at once after a rate limit or a refusal', async () => {
    const limited = new Response(JSON.stringify({ error: { message: 'busy', code: 429 } }));
    const { fetch, models } = fakeFetch(answer('', 429), answer('', 404), limited, answer(GOOD));
    const { events, onEvent } = eventsOf();
    const translator = createOpenRouter({ apiKey: 'k', models: ['m1', 'm2', 'm3', 'm4'], fetch, retryDelayMs: 0 });
    expect((await translator.translate('Hi. Bye.', sentences, { onEvent })).model).toBe('m4');
    expect(models()).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(failures(events)).toEqual([
      'm1#1 rate-limited -> next-model',
      'm2#1 refused -> next-model',
      'm3#1 rate-limited -> next-model',
    ]);
  });

  it('gives up a request that takes too long and tries the same model again', async () => {
    const { fetch } = fakeFetch(HANG, answer(GOOD));
    const { events, onEvent } = eventsOf();
    const translator = createOpenRouter({ apiKey: 'k', models: ['m1'], fetch, retryDelayMs: 0, timeoutMs: 20 });
    expect((await translator.translate('Hi. Bye.', sentences, { onEvent })).model).toBe('m1');
    expect(failures(events)).toEqual(['m1#1 timeout -> retry']);
  });

  it('stops when the time for the whole translation runs out', async () => {
    const { fetch, models } = fakeFetch(HANG, HANG);
    const { events, onEvent } = eventsOf();
    const translator = createOpenRouter({
      apiKey: 'k',
      models: ['m1', 'm2'],
      fetch,
      retryDelayMs: 0,
      timeoutMs: 10_000,
      budgetMs: 30,
    });
    await expect(translator.translate('Hi. Bye.', sentences, { onEvent })).rejects.toThrow(/time for translation ran out/);
    expect(models()).toEqual(['m1']);
    expect(failures(events)).toEqual(['m1#1 timeout -> no-time-left']);
  });

  it('fails after the last model, with every failure reported', async () => {
    const { fetch } = fakeFetch(answer('', 429), answer('x'), answer('x'));
    const { events, onEvent } = eventsOf();
    const translator = createOpenRouter({ apiKey: 'k', models: ['m1', 'm2'], fetch, retryDelayMs: 0 });
    await expect(translator.translate('Hi. Bye.', sentences, { onEvent })).rejects.toThrow(/no model gave a usable answer/);
    expect(failures(events)).toEqual([
      'm1#1 rate-limited -> next-model',
      'm2#1 bad-answer -> retry',
      'm2#2 bad-answer -> no-models-left',
    ]);
    const last = events.at(-1);
    expect(last?.type === 'failed' && last.detail).toContain('the answer starts with "x"');
  });

  it('treats a cut-off answer as a broken one', async () => {
    const cut = new Response(JSON.stringify({ choices: [{ message: { content: GOOD }, finish_reason: 'length' }] }));
    const { fetch } = fakeFetch(cut, answer(GOOD));
    const { events, onEvent } = eventsOf();
    const translator = createOpenRouter({ apiKey: 'k', models: ['m1'], fetch, retryDelayMs: 0 });
    expect((await translator.translate('Hi. Bye.', sentences, { onEvent })).translations).toHaveLength(2);
    expect(failures(events)).toEqual(['m1#1 bad-answer -> retry']);
  });
});
