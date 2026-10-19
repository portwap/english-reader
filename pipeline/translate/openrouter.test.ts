// Tests for the OpenRouter adapter with a fake network: answer parsing, retries, fallback models and time limits.

import { describe, expect, it } from 'vitest';
import { buildPrompt, createOpenRouter, PART_SIZE, parseAnswer, splitIntoParts } from './openrouter.ts';
import type { TranslationEvent } from './translator.ts';

/** Builds an OpenRouter-style HTTP response with the given answer text. */
function answer(content: string, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), { status });
}

/** Stands for a model that never answers: the request waits until its time limit aborts it. */
const HANG = 'hang';

/** What a test sees of one request. */
interface SentBody {
  model: string;
  session_id?: string;
  messages: { content: string }[];
}

/**
 * A fake fetch that records each request body and answers with what the given function returns for it.
 * @param respond Gives the answer to one request; HANG for no answer, undefined when the test expected no request.
 */
function recordingFetch(respond: (body: SentBody) => Response | typeof HANG | undefined) {
  const bodies: SentBody[] = [];
  const fetch = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as SentBody;
    bodies.push(body);
    const next = respond(body);
    if (!next) throw new Error('no more fake responses');
    if (next === HANG) {
      return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason)));
    }
    return next;
  }) as unknown as typeof globalThis.fetch;
  return { fetch, bodies, models: () => bodies.map((body) => body.model) };
}

/** A fake fetch that gives the given answers in order. */
function fakeFetch(...responses: (Response | typeof HANG)[]) {
  return recordingFetch(() => responses.shift());
}

/**
 * Answers a request the way a working model would: a Russian translation for every sentence it was sent.
 * @param body The request.
 * @returns The answer, with translations such as "Перевод 21" for sentence 21.
 */
function translateAll(body: SentBody): Response {
  const prompt = body.messages[1]?.content ?? '';
  const numbers = [...prompt.matchAll(/^(\d+)\. /gm)].map((match) => Number(match[1]));
  return answer(JSON.stringify({ translations: numbers.map((n) => ({ n, ru: `Перевод ${n}` })) }));
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

/** The first part of a text: its sentences numbered from 1. */
const whole = (sentences: string[]) => ({ first: 1, sentences });

describe('parseAnswer', () => {
  it('returns one translation per sentence in sentence order', () => {
    expect(parseAnswer('{"translations":[{"n":2,"ru":"Б"},{"n":1,"ru":"А"}]}', whole(['A.', 'B.']))).toEqual(['А', 'Б']);
  });

  it('reads the numbers of a later part by their place in the whole text', () => {
    const part = { first: 21, sentences: ['A.', 'B.'] };
    expect(parseAnswer('{"translations":[{"n":21,"ru":"А"},{"n":22,"ru":"Б"}]}', part)).toEqual(['А', 'Б']);
    expect(() => parseAnswer('{"translations":[{"n":1,"ru":"А"},{"n":2,"ru":"Б"}]}', part)).toThrow(/sentence 21, 22/);
  });

  it('reads JSON wrapped in a code block', () => {
    expect(parseAnswer('```json\n' + GOOD + '\n```', whole(['Hi.', 'Bye.']))).toEqual(['Привет.', 'Пока.']);
  });

  it('rejects an answer that misses a sentence', () => {
    expect(() => parseAnswer('{"translations":[{"n":1,"ru":"А"}]}', whole(['A.', 'B.']))).toThrow(
      /1 translations for 2 sentences/,
    );
  });

  it('rejects an empty translation', () => {
    expect(() => parseAnswer('{"translations":[{"n":1,"ru":"А"},{"n":2,"ru":" "}]}', whole(['A.', 'B.']))).toThrow(
      /sentence 2/,
    );
  });

  it('rejects a sentence translated twice', () => {
    expect(() => parseAnswer('{"translations":[{"n":1,"ru":"А"},{"n":1,"ru":"Б"}]}', whole(['A.', 'B.']))).toThrow(
      /twice/,
    );
  });

  it('rejects a sentence left in English, but allows a short one to stay as it is', () => {
    const part = whole(['She looked at the painting.', 'BBC News.']);
    expect(() =>
      parseAnswer('{"translations":[{"n":1,"ru":"She looked at the painting."},{"n":2,"ru":"BBC News."}]}', part),
    ).toThrow(/sentence 1 came back without Russian letters/);
    expect(
      parseAnswer('{"translations":[{"n":1,"ru":"Она посмотрела на картину."},{"n":2,"ru":"BBC News."}]}', part),
    ).toEqual(['Она посмотрела на картину.', 'BBC News.']);
  });
});

describe('splitIntoParts', () => {
  const numbered = (count: number) => Array.from({ length: count }, (_, i) => `S${i + 1}.`);

  it('keeps a short text in one part', () => {
    expect(splitIntoParts(numbered(20))).toEqual([{ first: 1, sentences: numbered(20) }]);
  });

  it('splits a long text into parts of nearly equal size, at most PART_SIZE each, in order', () => {
    const parts = splitIntoParts(numbered(70));
    expect(parts.map((part) => [part.first, part.sentences.length])).toEqual([
      [1, 18],
      [19, 18],
      [37, 18],
      [55, 16],
    ]);
    expect(parts.flatMap((part) => part.sentences)).toEqual(numbered(70));
    expect(Math.max(...parts.map((part) => part.sentences.length))).toBeLessThanOrEqual(PART_SIZE);
  });
});

describe('buildPrompt', () => {
  it('includes the whole text and the sentences of the part with their numbers in the text', () => {
    const prompt = buildPrompt('Hi. Bye. Yes.', { first: 2, sentences: ['Bye.', 'Yes.'] });
    expect(prompt).toContain('Hi. Bye. Yes.');
    expect(prompt).toContain('(2, numbers 2–3)');
    expect(prompt).toContain('2. Bye.\n3. Yes.');
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

  it('translates a long text in parts at the same time and puts the translations back in order', async () => {
    const long = Array.from({ length: 45 }, (_, i) => `S${i + 1}.`);
    const { fetch, bodies } = recordingFetch(translateAll);
    const { events, onEvent } = eventsOf();
    const translator = createOpenRouter({ apiKey: 'k', models: ['m1', 'm2'], fetch, retryDelayMs: 0 });
    const result = await translator.translate(long.join(' '), long, { onEvent, sessionId: 'anna-1' });
    expect(bodies).toHaveLength(3);
    expect(bodies.every((body) => body.model === 'm1' && body.session_id === 'anna-1')).toBe(true);
    expect(result.translations).toEqual(long.map((_, i) => `Перевод ${i + 1}`));
    expect(events.map((e) => (e.type === 'attempt' ? `${e.part}/${e.parts}` : e.type))).toEqual(['1/3', '2/3', '3/3']);
  });

  it('gives the whole text to the next model when a part fails, so one model translates all of it', async () => {
    const long = Array.from({ length: 45 }, (_, i) => `S${i + 1}.`);
    // m1 answers parts 1 and 3, but keeps losing sentences in part 2.
    const { fetch, models } = recordingFetch((body) =>
      body.model === 'm1' && body.messages[1]?.content.includes('\n16. ') ? answer(GOOD) : translateAll(body),
    );
    const { events, onEvent } = eventsOf();
    const translator = createOpenRouter({ apiKey: 'k', models: ['m1', 'm2'], fetch, retryDelayMs: 0 });
    const result = await translator.translate(long.join(' '), long, { onEvent });
    expect(result.model).toBe('m2');
    expect(result.translations).toHaveLength(45);
    expect(models().filter((model) => model === 'm2')).toHaveLength(3);
    expect(failures(events)).toEqual(['m1#1 bad-answer -> retry', 'm1#2 bad-answer -> next-model']);
    expect(events.filter((e) => e.type === 'failed').map((e) => e.part)).toEqual([2, 2]);
  });

  it('stops the other parts of a model that failed, without reporting them', async () => {
    const long = Array.from({ length: 45 }, (_, i) => `S${i + 1}.`);
    // m1 never answers parts 1 and 3 and refuses part 2; m2 translates everything.
    const { fetch } = recordingFetch((body) => {
      if (body.model !== 'm1') return translateAll(body);
      return body.messages[1]?.content.includes('\n16. ') ? answer('', 403) : HANG;
    });
    const { events, onEvent } = eventsOf();
    const translator = createOpenRouter({ apiKey: 'k', models: ['m1', 'm2'], fetch, retryDelayMs: 0 });
    expect((await translator.translate(long.join(' '), long, { onEvent })).model).toBe('m2');
    expect(failures(events)).toEqual(['m1#1 refused -> next-model']);
  });
});
