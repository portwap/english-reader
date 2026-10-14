// Reading and writing texts for the admin functions, with strong consistency:
// the admin must see a change right after making it, not up to a minute later.

import { getStore } from '@netlify/blobs';
import { AUDIO_STORE, audioKey, summaryOf, TEXTS_STORE } from '../../shared/storage.ts';
import type { TextDoc, TextSummary } from '../../shared/text-doc.ts';
import { startProcessing } from './trigger.ts';

const texts = () => getStore({ name: TEXTS_STORE, consistency: 'strong' });
const audio = () => getStore({ name: AUDIO_STORE, consistency: 'strong' });

/**
 * Reads one text.
 * @param id Text id, already checked against ID_PATTERN.
 * @returns The document, or null if there is none.
 */
export async function loadDoc(id: string): Promise<TextDoc | null> {
  return (await texts().get(id, { type: 'json' })) as TextDoc | null;
}

/**
 * Saves a text with its summary as metadata.
 * @param doc The document.
 */
export async function saveDoc(doc: TextDoc): Promise<void> {
  await texts().setJSON(doc.id, doc, { metadata: { ...summaryOf(doc) } });
}

/**
 * Lists all texts, whatever their status, newest first.
 * @returns Summaries of all texts.
 */
export async function listTexts(): Promise<TextSummary[]> {
  const store = texts();
  const { blobs } = await store.list();
  const summaries = await Promise.all(
    blobs.map(async ({ key }) => (await store.getMetadata(key))?.metadata as TextSummary | undefined),
  );
  return summaries
    .filter((summary): summary is TextSummary => Boolean(summary?.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Deletes a text and its audio.
 * @param doc The text to delete.
 */
export async function deleteText(doc: TextDoc): Promise<void> {
  // The audio key is derived from the id, so audio from an earlier run is removed even if the document no longer points to it.
  // Audio goes first: if the second delete fails, the text is still listed and can be deleted again.
  await audio().delete(audioKey(doc.id));
  await texts().delete(doc.id);
}

/**
 * Saves a text as "processing" and starts its workflow. If the workflow cannot start,
 * the text is saved with status "error" and the reason, so the admin can retry.
 * @param doc The text, already marked as processing.
 * @returns null on success, or the error message.
 */
export async function saveAndProcess(doc: TextDoc): Promise<string | null> {
  await saveDoc(doc);
  try {
    await startProcessing(doc.id);
    return null;
  } catch (error) {
    const message = `Не удалось запустить обработку: ${error instanceof Error ? error.message : String(error)}`;
    await saveDoc({ ...doc, status: 'error', error: message, updatedAt: new Date().toISOString() });
    return message;
  }
}
