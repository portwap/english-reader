// Names and layout of the Netlify Blobs storage, shared by the pipeline (writes) and the API (reads).
// Keeping them in one place means both sides always agree on where things are.

import type { TextDoc, TextSummary } from './text-doc.ts';

/** Store with one JSON TextDoc per text, keyed by text id. Each entry's metadata is its TextSummary. */
export const TEXTS_STORE = 'texts';

/** Store with one mp3 per text; the key is TextDoc.audio. */
export const AUDIO_STORE = 'audio';

/**
 * Gives the storage key of a text's mp3.
 * @param id Text id.
 * @returns Key in the audio store.
 */
export function audioKey(id: string): string {
  return `${id}.mp3`;
}

/**
 * Takes the short facts of a text, stored as metadata so the list of texts is cheap to build.
 * @param doc A text document.
 * @returns Its summary.
 */
export function summaryOf(doc: TextDoc): TextSummary {
  return { id: doc.id, title: doc.title, createdAt: doc.createdAt, status: doc.status };
}
