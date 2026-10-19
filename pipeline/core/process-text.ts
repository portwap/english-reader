// Turns a text document waiting for processing into a ready one with its mp3: split, voice, translate, check, assemble.
// Services come in as arguments, so tests can run the whole flow with fakes.

import { audioKey } from '../../shared/storage.ts';
import type { ProcessEvent, ProcessStep, TextDoc } from '../../shared/text-doc.ts';
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
  /** Called with the document when its status changes (processing, then ready or error) and after each logged step. */
  saveDoc: (doc: TextDoc) => Promise<void>;
  /** Called once with the finished mp3, before the ready document is saved. */
  saveAudio: (key: string, mp3: Buffer) => Promise<void>;
  /** Called with each logged step as it happens, for example to print it. */
  onEvent?: (event: ProcessEvent) => void;
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
  const startedEvent: ProcessEvent = { type: 'started', at: now() };
  const log: ProcessEvent[] = [startedEvent];
  const doc: TextDoc = {
    ...input,
    status: 'processing',
    updatedAt: now(),
    // The admin's choice of model stays; the model that actually translates is filled in when ready.
    translation: { ...input.translation, provider: deps.translator.id, model: '' },
    audio: '',
    sentences: [],
    log,
  };
  delete doc.error;
  deps.onEvent?.(startedEvent);
  await deps.saveDoc(doc);

  // Each step is saved as it happens, so the admin page can show the run. Saves go one after another, so they
  // arrive in order; a failed progress save is only reported, because the final save still carries the whole log.
  let finished = false;
  let saving = Promise.resolve();
  const note = (step: ProcessStep) => {
    // After the end, a step still coming in (the translation goes on after the voice failed) must not be saved.
    if (finished) return;
    const event = { ...step, at: now() } as ProcessEvent;
    log.push(event);
    deps.onEvent?.(event);
    const snapshot: TextDoc = { ...doc, log: [...log] };
    saving = saving.then(() =>
      deps.saveDoc(snapshot).catch((error: unknown) => console.warn('Could not save the progress:', error)),
    );
  };
  /** Stops logging and waits for the progress saves, so the final save is the last one. */
  const finish = async (last: ProcessStep) => {
    finished = true;
    await saving;
    const event = { ...last, at: now() } as ProcessEvent;
    log.push(event);
    deps.onEvent?.(event);
    return [...log];
  };
  const seconds = (value: number) => Math.round(value * 10) / 10;

  try {
    if (!doc.source) throw new Error('The text is empty.');
    const sentences = splitSentences(doc.source);
    const sentenceTexts = sentences.map((sentence) => sentence.text);
    // Voicing uses the CPU and translation waits on the network, so they run side by side.
    const [voiced, translated] = await Promise.all([
      timed(deps.tts.synthesize(doc.source, doc.tts.voice)).then((result) => {
        note({ type: 'voiced', seconds: seconds(result.seconds) });
        return result;
      }),
      timed(
        deps.translator.translate(doc.source, sentenceTexts, { sessionId: doc.id, onEvent: (step) => note(step) }),
      ).then((result) => {
        note({ type: 'translated', model: result.value.model, seconds: seconds(result.seconds) });
        return result;
      }),
    ]);

    const timingProblems = checkTimings(voiced.value.words, voiced.value.duration);
    if (timingProblems.length > 0) throw new Error(`Bad word timings: ${timingProblems.join('; ')}`);
    const translationProblems = checkTranslations(sentenceTexts, translated.value.translations);
    if (translationProblems.length > 0) throw new Error(`Bad translation: ${translationProblems.join('; ')}`);

    const words = alignWords(doc.source, voiced.value.words);
    // Audio goes first, so a ready document never points to missing audio.
    await deps.saveAudio(audioKey(doc.id), voiced.value.mp3);
    const ready: TextDoc = {
      ...doc,
      status: 'ready',
      updatedAt: now(),
      translation: { ...doc.translation, model: translated.value.model },
      audio: audioKey(doc.id),
      sentences: assembleSentences(sentences, words, translated.value.translations),
      log: await finish({ type: 'ready' }),
    };
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
    await deps.saveDoc({ ...doc, status: 'error', error: message, updatedAt: now(), log: await finish({ type: 'error' }) });
    throw error;
  }
}
