// Tests for the whole processing flow with fake voice, translator and storage.

import { describe, expect, it } from 'vitest';
import type { TextDoc } from '../../shared/text-doc.ts';
import type { TtsProvider } from '../tts/provider.ts';
import type { Translator } from '../translate/translator.ts';
import { processText, type ProcessDeps } from './process-text.ts';

/** A text saved by the admin and waiting for processing. */
const waiting: TextDoc = {
  schemaVersion: 1,
  id: 'anna-1',
  title: 'Anna',
  createdAt: '2026-10-13T10:00:00.000Z',
  updatedAt: '2026-10-13T10:00:00.000Z',
  status: 'processing',
  source: 'Anna reads.\n\nShe likes “books”. Do you?',
  tts: { provider: 'fake-tts', voice: 'v1' },
  translation: { provider: 'fake-tr', model: '', preferred: 'chosen-model' },
  audio: '',
  sentences: [],
};

/** A fake voice that speaks every word of the text one second apart. */
const fakeTts: TtsProvider = {
  id: 'fake-tts',
  async synthesize(text) {
    const words = (text.match(/[\p{L}\p{N}]+/gu) ?? []).map((word, i) => ({ text: word, start: i, end: i + 0.8 }));
    return { mp3: Buffer.from('mp3'), duration: words.length, words };
  },
};

/** A fake translator that numbers its translations. */
const fakeTranslator: Translator = {
  id: 'fake-tr',
  async translate(_fullText, sentences) {
    return { translations: sentences.map((_, i) => `Перевод ${i + 1}`), model: 'fake-model' };
  },
};

/** Collects everything the flow saves, so tests can check the order of saves. */
function deps(overrides: Partial<ProcessDeps> = {}) {
  const saved: TextDoc[] = [];
  const audio: string[] = [];
  const all: ProcessDeps = {
    tts: fakeTts,
    translator: fakeTranslator,
    saveDoc: async (doc) => void saved.push(structuredClone(doc)),
    saveAudio: async (key) => void audio.push(key),
    now: () => new Date('2026-10-14T09:00:00Z'),
    ...overrides,
  };
  return { all, saved, audio };
}

describe('processText', () => {
  it('saves the text as processing, then saves audio and the ready document', async () => {
    const { all, saved, audio } = deps();
    const { doc } = await processText(waiting, all);

    expect(saved[0]?.status).toBe('processing');
    expect(saved.at(-1)?.status).toBe('ready');
    expect(saved.slice(1, -1).every((d) => d.status === 'processing')).toBe(true);
    expect(audio).toEqual(['anna-1.mp3']);
    expect(doc).toMatchObject({
      id: 'anna-1',
      title: 'Anna',
      createdAt: '2026-10-13T10:00:00.000Z',
      updatedAt: '2026-10-14T09:00:00.000Z',
      tts: { provider: 'fake-tts', voice: 'v1' },
      translation: { provider: 'fake-tr', model: 'fake-model', preferred: 'chosen-model' },
      audio: 'anna-1.mp3',
    });
    expect(doc.sentences.map((s) => [s.text, s.paragraph, s.translation])).toEqual([
      ['Anna reads.', 0, 'Перевод 1'],
      ['She likes “books”.', 1, 'Перевод 2'],
      ['Do you?', 1, 'Перевод 3'],
    ]);
  });

  it('gives each word its place inside its sentence and each sentence its time span', async () => {
    const { doc } = await processText(waiting, deps().all);
    const second = doc.sentences[1];
    expect(second?.words.map((w) => [w.text, w.at])).toEqual([
      ['She', 0],
      ['likes', 4],
      ['books', 11],
    ]);
    expect(second).toMatchObject({ start: 2, end: 4.8 });
    for (const sentence of doc.sentences) {
      for (const word of sentence.words) expect(sentence.text.slice(word.at, word.at + word.text.length)).toBe(word.text);
    }
  });

  it('keeps the time the admin started processing, so the wait is counted from it', async () => {
    const { all, saved } = deps();
    await processText(waiting, all);
    expect(saved[0]?.updatedAt).toBe('2026-10-13T10:00:00.000Z');
  });

  it('replaces the results and the error of an earlier run', async () => {
    const failedBefore: TextDoc = { ...waiting, status: 'error', error: 'old problem', audio: 'old.mp3' };
    const { all, saved } = deps();
    await processText(failedBefore, all);
    expect(saved[0]).toMatchObject({ status: 'processing', audio: '', sentences: [] });
    expect(saved[0]?.error).toBeUndefined();
    expect(saved[1]?.error).toBeUndefined();
  });

  it('saves the text with status error and the reason when a step fails', async () => {
    const failing: Translator = { id: 'x', translate: async () => Promise.reject(new Error('model is down')) };
    const { all, saved, audio } = deps({ translator: failing });
    await expect(processText(waiting, all)).rejects.toThrow('model is down');
    expect([saved[0]?.status, saved[0]?.error]).toEqual(['processing', undefined]);
    expect([saved.at(-1)?.status, saved.at(-1)?.error]).toEqual(['error', 'model is down']);
    expect(saved.at(-1)?.log?.map((e) => e.type)).toContain('error');
    expect(audio).toEqual([]);
  });

  it('logs each step with its time and saves it as it happens', async () => {
    const reporting: Translator = {
      id: 'fake-tr',
      async translate(fullText, sentences, options) {
        options?.onEvent?.({ type: 'attempt', model: 'm1', attempt: 1 });
        options?.onEvent?.({
          type: 'failed',
          model: 'm1',
          attempt: 1,
          seconds: 2,
          reason: 'rate-limited',
          status: 429,
          then: 'next-model',
          detail: 'busy',
        });
        options?.onEvent?.({ type: 'attempt', model: 'm2', attempt: 1 });
        expect(options?.sessionId).toBe('anna-1');
        return fakeTranslator.translate(fullText, sentences);
      },
    };
    const printed: string[] = [];
    const { all, saved } = deps({ translator: reporting, onEvent: (event) => void printed.push(event.type) });
    const { doc } = await processText(waiting, all);
    const types = doc.log?.map((e) => e.type) ?? [];
    expect(types[0]).toBe('started');
    expect(types.at(-1)).toBe('ready');
    expect(types.filter((t) => t === 'attempt' || t === 'failed')).toEqual(['attempt', 'failed', 'attempt']);
    expect(types).toContain('voiced');
    expect(types).toContain('translated');
    expect(doc.log?.every((e) => e.at === '2026-10-14T09:00:00.000Z')).toBe(true);
    expect(printed).toEqual(types);
    // Every step was saved while processing, each save with a longer log than the one before.
    const lengths = saved.map((d) => d.log?.length ?? 0);
    expect(lengths).toEqual([...lengths].sort((a, b) => a - b));
    expect(new Set(lengths).size).toBe(lengths.length);
  });

  it('saves nothing after the end, even if the translation reports a step later', async () => {
    let lateReport = () => {};
    const slow: Translator = {
      id: 'fake-tr',
      translate: (_fullText, _sentences, options) =>
        new Promise((resolve) => {
          lateReport = () => {
            options?.onEvent?.({ type: 'attempt', model: 'm2', attempt: 1 });
            resolve({ translations: [], model: 'm2' });
          };
        }),
    };
    const broken: TtsProvider = { ...fakeTts, synthesize: async () => Promise.reject(new Error('voice is down')) };
    const { all, saved } = deps({ tts: broken, translator: slow });
    await expect(processText(waiting, all)).rejects.toThrow('voice is down');
    const count = saved.length;
    lateReport();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(saved).toHaveLength(count);
    expect(saved.at(-1)?.status).toBe('error');
  });

  it('refuses a voice adapter that does not match the voice of the text', async () => {
    const { all, saved } = deps({ tts: { ...fakeTts, id: 'other' } });
    await expect(processText(waiting, all)).rejects.toThrow(/"other" was given for a "fake-tts" voice/);
    expect(saved).toEqual([]);
  });
});
