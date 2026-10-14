// Turns a text document waiting for processing into a ready one with its mp3: split, voice, translate, check, assemble.
// Services come in as arguments, so tests can run the whole flow with fakes.

import { audioKey } from '../../shared/storage.ts';
import type { TextDoc } from '../../shared/text-doc.ts';
import type { TtsProvider } from '../tts/provider.ts';
import type { Translator } from '../translate/translator.ts';
import { alignWords } from './align.ts';
import { assembleSentences } from './assemble.ts';
import { checkTimings, checkTranslations } from './checks.ts';
import { splitSentences } from './split.ts';

/** The services one run uses. */
export interface ProcessDeps {
  /** The voice adapter for the document's tts.provider. */
  tts: TtsProvider;
  translator: Translator;
  /** Called with the document each time its status changes (processing, then ready or error). */
  saveDoc: (doc: TextDoc) => Promise<void>;
  /** Called once with the finished mp3, before the ready document is saved. */
  saveAudio: (key: string, mp3: Buffer) => Promise<void>;
  /** Replaceable for tests. */
  now?: () => Date;
}

/** The result of a successful run, with step times for measuring. */
export interface ProcessResult {
  doc: TextDoc;
  mp3: Buffer;
  /** Seconds spent on each step. */
  seconds: { voice: number; translation: number; total: number };
}

/**
 * Measures how long a promise takes.
 * @param work The promise.
 * @returns Its value and the seconds it took.
 */
async function timed<T>(work: Promise<T>): Promise<{ value: T; seconds: number }> {
  const started = performance.now();
  const value = await work;
  return { value, seconds: (performance.now() - started) / 1000 };
}

/**
 * Processes one text. Saves it as "processing" first, then as "ready" with its audio,
 * or as "error" with the reason if any step fails.
 * @param input The document to process; its source, title and voice are used, old results are replaced.
 * @param deps Services.
 * @returns The ready document, its mp3 and step times.
 * @throws The step's error, after the "error" document is saved.
 */
export async function processText(input: TextDoc, deps: ProcessDeps): Promise<ProcessResult> {
  const now = () => (deps.now?.() ?? new Date()).toISOString();
  const started = performance.now();
  if (deps.tts.id !== input.tts.provider) {
    throw new Error(`Voice adapter "${deps.tts.id}" was given for a "${input.tts.provider}" voice.`);
  }
  const doc: TextDoc = {
    ...input,
    status: 'processing',
    updatedAt: now(),
    translation: { provider: deps.translator.id, model: '' },
    audio: '',
    sentences: [],
  };
  delete doc.error;
  await deps.saveDoc(doc);

  try {
    if (!doc.source) throw new Error('The text is empty.');
    const sentences = splitSentences(doc.source);
    const sentenceTexts = sentences.map((sentence) => sentence.text);
    // Voicing uses the CPU and translation waits on the network, so they run side by side.
    const [voiced, translated] = await Promise.all([
      timed(deps.tts.synthesize(doc.source, doc.tts.voice)),
      timed(deps.translator.translate(doc.source, sentenceTexts)),
    ]);

    const timingProblems = checkTimings(voiced.value.words, voiced.value.duration);
    if (timingProblems.length > 0) throw new Error(`Bad word timings: ${timingProblems.join('; ')}`);
    const translationProblems = checkTranslations(sentenceTexts, translated.value.translations);
    if (translationProblems.length > 0) throw new Error(`Bad translation: ${translationProblems.join('; ')}`);

    const words = alignWords(doc.source, voiced.value.words);
    const ready: TextDoc = {
      ...doc,
      status: 'ready',
      updatedAt: now(),
      translation: { provider: deps.translator.id, model: translated.value.model },
      audio: audioKey(doc.id),
      sentences: assembleSentences(sentences, words, translated.value.translations),
    };
    // Audio goes first, so a ready document never points to missing audio.
    await deps.saveAudio(ready.audio, voiced.value.mp3);
    await deps.saveDoc(ready);
    return {
      doc: ready,
      mp3: voiced.value.mp3,
      seconds: {
        voice: voiced.seconds,
        translation: translated.seconds,
        total: (performance.now() - started) / 1000,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.saveDoc({ ...doc, status: 'error', error: message, updatedAt: now() });
    throw error;
  }
}
