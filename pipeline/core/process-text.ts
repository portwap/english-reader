// Turns one pasted text into a ready TextDoc and its mp3: split, voice, translate, check, assemble.
// Services come in as arguments, so tests can run the whole flow with fakes.

import { randomBytes } from 'node:crypto';
import { audioKey } from '../../shared/storage.ts';
import type { TextDoc } from '../../shared/text-doc.ts';
import type { TtsProvider } from '../tts/provider.ts';
import type { Translator } from '../translate/translator.ts';
import { alignWords } from './align.ts';
import { assembleSentences } from './assemble.ts';
import { checkTimings, checkTranslations } from './checks.ts';
import { normalizeSource, splitSentences } from './split.ts';

/** What one run needs to know about the text. */
export interface TextInput {
  title: string;
  text: string;
}

/** The services and settings one run uses. */
export interface ProcessDeps {
  tts: TtsProvider;
  voice: string;
  translator: Translator;
  /** Called with the document each time its status changes (processing, then ready or error). */
  saveDoc: (doc: TextDoc) => Promise<void>;
  /** Called once with the finished mp3, before the ready document is saved. */
  saveAudio: (key: string, mp3: Buffer) => Promise<void>;
  /** Replaceable for tests. */
  now?: () => Date;
  makeId?: (title: string) => string;
}

/** The result of a successful run, with step times for measuring. */
export interface ProcessResult {
  doc: TextDoc;
  mp3: Buffer;
  /** Seconds spent on each step. */
  seconds: { voice: number; translation: number; total: number };
}

/**
 * Makes a readable, unique id from a title: a short ASCII slug plus random characters.
 * @param title Text title.
 * @returns An id such as "a-walk-in-the-park-3f9a1c".
 */
export function makeTextId(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return `${slug || 'text'}-${randomBytes(3).toString('hex')}`;
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
 * @param input Title and text as pasted.
 * @param deps Services and settings.
 * @returns The ready document, its mp3 and step times.
 * @throws The step's error, after the "error" document is saved.
 */
export async function processText(input: TextInput, deps: ProcessDeps): Promise<ProcessResult> {
  const title = input.title.trim();
  const source = normalizeSource(input.text);
  if (!title) throw new Error('The title is empty.');
  if (!source) throw new Error('The text is empty.');

  const started = performance.now();
  const doc: TextDoc = {
    schemaVersion: 1,
    id: (deps.makeId ?? makeTextId)(title),
    title,
    createdAt: (deps.now?.() ?? new Date()).toISOString(),
    status: 'processing',
    source,
    tts: { provider: deps.tts.id, voice: deps.voice },
    translation: { provider: deps.translator.id, model: '' },
    audio: '',
    sentences: [],
  };
  await deps.saveDoc(doc);

  try {
    const sentences = splitSentences(source);
    const sentenceTexts = sentences.map((sentence) => sentence.text);
    // Voicing uses the CPU and translation waits on the network, so they run side by side.
    const [voiced, translated] = await Promise.all([
      timed(deps.tts.synthesize(source, deps.voice)),
      timed(deps.translator.translate(source, sentenceTexts)),
    ]);

    const timingProblems = checkTimings(voiced.value.words, voiced.value.duration);
    if (timingProblems.length > 0) throw new Error(`Bad word timings: ${timingProblems.join('; ')}`);
    const translationProblems = checkTranslations(sentenceTexts, translated.value.translations);
    if (translationProblems.length > 0) throw new Error(`Bad translation: ${translationProblems.join('; ')}`);

    const words = alignWords(source, voiced.value.words);
    const ready: TextDoc = {
      ...doc,
      status: 'ready',
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
    await deps.saveDoc({ ...doc, status: 'error', error: message });
    throw error;
  }
}
