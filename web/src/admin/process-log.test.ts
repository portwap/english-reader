// Tests for the Russian wording of the processing log on the admin page.

import { describe, expect, it } from 'vitest';
import { describeEvent, formatDuration } from './process-log.ts';

const at = '2026-10-19T17:43:52.000Z';

describe('formatDuration', () => {
  it('shows tenths for short steps, seconds up to two minutes, then minutes and seconds', () => {
    expect(formatDuration(8.44)).toBe('8,4 с');
    expect(formatDuration(62.3)).toBe('62 с');
    expect(formatDuration(275)).toBe('4 мин 35 с');
    expect(formatDuration(300)).toBe('5 мин');
  });
});

describe('describeEvent', () => {
  it('names the model and the attempt', () => {
    expect(describeEvent({ type: 'attempt', at, model: 'nvidia/nemotron-3-super-120b-a12b:free', attempt: 2 }).text).toBe(
      'Перевод: NVIDIA Nemotron 3 Super, попытка 2',
    );
  });

  it('says why an attempt failed and what came next, with the technical detail apart', () => {
    const line = describeEvent({
      type: 'failed',
      at,
      model: 'google/gemma-4-31b-it:free',
      attempt: 1,
      seconds: 0.1,
      reason: 'rate-limited',
      status: 429,
      then: 'next-model',
      detail: 'HTTP 429: busy',
    });
    expect(line).toEqual({ text: 'Google Gemma 4 31B: хост перегружен (429) → следующая модель', detail: 'HTTP 429: busy' });
  });

  it('tells a model that did not answer in time', () => {
    const line = describeEvent({
      type: 'failed',
      at,
      model: 'nvidia/nemotron-3-super-120b-a12b:free',
      attempt: 1,
      seconds: 300,
      reason: 'timeout',
      then: 'retry',
      detail: 'The operation was aborted due to timeout',
    });
    expect(line.text).toBe('NVIDIA Nemotron 3 Super: нет ответа 5 мин → повтор');
  });

  it('reports the finished steps with their time', () => {
    expect(describeEvent({ type: 'voiced', at, seconds: 62.3 }).text).toBe('Озвучка готова за 62 с');
    expect(
      describeEvent({ type: 'translated', at, model: 'google/gemma-4-31b-it:free', seconds: 30.4 }).text,
    ).toBe('Перевод готов за 30 с (Google Gemma 4 31B)');
  });
});
