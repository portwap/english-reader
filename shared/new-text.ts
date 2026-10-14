// Rules for a new or edited text, and the document it starts as. Shared by the admin API (which checks
// what the admin sent) and the pipeline, so both sides apply the same limits.

import type { TextDoc } from './text-doc.ts';
import { findTranslationModel } from './translation-models.ts';
import { findVoice } from './voices.ts';

/** Longest text accepted. Real texts are about 500–2,500 characters; this leaves room. */
export const MAX_TEXT_LENGTH = 5000;

/** Longest title accepted. */
export const MAX_TITLE_LENGTH = 200;

/** Shape of a text id: lowercase ASCII letters, digits and dashes. Anything else is refused before it reaches storage. */
export const ID_PATTERN = /^[a-z0-9-]{1,64}$/;

/** A run takes 2–3 minutes and is stopped after 15; a text still "processing" after this long is stuck. */
export const STUCK_AFTER_MS = 20 * 60 * 1000;

/**
 * Tells whether a text may be edited, retried or deleted now. While a run is working on a text, changes wait:
 * the run would otherwise overwrite them when it saves its result.
 * @param text The text's status and the time of its last status change.
 * @param now Current time.
 * @returns True unless the text is processing and not yet stuck.
 */
export function canChange(text: { status: string; updatedAt?: string; createdAt: string }, now: Date = new Date()): boolean {
  if (text.status !== 'processing') return true;
  const since = Date.parse(text.updatedAt ?? text.createdAt);
  return Number.isNaN(since) || now.getTime() - since > STUCK_AFTER_MS;
}

/** What the admin sends for a text. */
export interface TextInput {
  title: string;
  text: string;
  /** Voice key, for example "kokoro:am_liam". */
  voice: string;
  /** Translation model key, for example "openrouter:google/gemma-4-31b-it:free". */
  translationModel: string;
}

/**
 * Brings line endings to "\n" and trims the text, so positions are stable no matter where it was pasted from.
 * @param text Text as pasted.
 * @returns The same text with "\n" line endings and no spaces at the ends.
 */
export function normalizeSource(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim();
}

/**
 * Checks a title, a text and a voice against the rules.
 * @param input What the admin sent; fields may be missing or of the wrong type.
 * @returns A list of problems in Russian, for showing in the form; empty when all is well.
 */
export function checkTextInput(input: Partial<Record<keyof TextInput, unknown>>): string[] {
  const problems: string[] = [];
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const text = typeof input.text === 'string' ? normalizeSource(input.text) : '';
  if (!title) problems.push('Введите название.');
  if (title.length > MAX_TITLE_LENGTH) problems.push(`Название длиннее ${MAX_TITLE_LENGTH} символов.`);
  if (!text) problems.push('Вставьте текст.');
  if (text.length > MAX_TEXT_LENGTH) problems.push(`Текст длиннее ${MAX_TEXT_LENGTH} символов (сейчас ${text.length}).`);
  if (!/[A-Za-z]/.test(text) && text) problems.push('В тексте нет английских слов.');
  if (typeof input.voice !== 'string' || !findVoice(input.voice)) problems.push('Выберите голос из списка.');
  if (typeof input.translationModel !== 'string' || !findTranslationModel(input.translationModel)) {
    problems.push('Выберите модель перевода из списка.');
  }
  return problems;
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
  const random = Array.from(crypto.getRandomValues(new Uint8Array(3)), (byte) => byte.toString(16).padStart(2, '0'));
  return `${slug || 'text'}-${random.join('')}`;
}

/**
 * Makes the document of a new text, waiting to be processed.
 * @param input A title, text and voice that passed checkTextInput.
 * @param now Current time.
 * @returns A TextDoc with status "processing" and no audio or sentences yet.
 * @throws If the voice or the translation model is not an allowed one.
 */
export function newTextDoc(input: TextInput, now: Date = new Date()): TextDoc {
  const voice = findVoice(input.voice);
  if (!voice) throw new Error(`Unknown voice "${input.voice}".`);
  const model = findTranslationModel(input.translationModel);
  if (!model) throw new Error(`Unknown translation model "${input.translationModel}".`);
  const title = input.title.trim();
  return {
    schemaVersion: 1,
    id: makeTextId(title),
    title,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    status: 'processing',
    source: normalizeSource(input.text),
    tts: { provider: voice.provider, voice: voice.id },
    translation: { provider: model.provider, model: '', preferred: model.id },
    audio: '',
    sentences: [],
  };
}
