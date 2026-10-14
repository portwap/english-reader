// Admin API for one text: GET /api/admin/texts/:id (with its source, for editing), PATCH to edit, DELETE to remove.
// Only the logged-in admin may call it. While a run is working on a text, edits and deletion wait (see canChange).

import type { Config, Context } from '@netlify/functions';
import { canChange, checkTextInput, ID_PATTERN, normalizeSource, type TextInput } from '../../shared/new-text.ts';
import type { TextDoc } from '../../shared/text-doc.ts';
import { DEFAULT_TRANSLATION_MODEL, findTranslationModel } from '../../shared/translation-models.ts';
import { findVoice, voiceKey } from '../../shared/voices.ts';
import { checkAdmin } from '../lib/auth.ts';
import { deleteText, loadDoc, saveAndProcess, saveDoc } from '../lib/texts.ts';

/**
 * Reads, edits or deletes one text.
 * @param request GET; PATCH with JSON {title, text, voice, translationModel}; or DELETE.
 * @param context Holds the text id from the path.
 * @returns GET: the TextDoc. PATCH: the saved TextDoc, or 400 with {errors}, or 502 with {error} if processing
 *   could not start. DELETE: 204. 404 if there is no such text; 409 while a run is working on it.
 */
export default async (request: Request, context: Context): Promise<Response> => {
  const denied = await checkAdmin(request, request.method !== 'GET');
  if (denied) return denied;

  const id = context.params.id ?? '';
  const doc = ID_PATTERN.test(id) ? await loadDoc(id) : null;
  if (!doc) return Response.json({ error: 'Такого текста нет.' }, { status: 404 });

  if (request.method === 'GET') {
    return Response.json(doc, { headers: { 'Cache-Control': 'no-store' } });
  }
  if (!canChange(doc)) {
    return Response.json({ error: 'Текст ещё обрабатывается. Подождите пару минут.' }, { status: 409 });
  }

  if (request.method === 'DELETE') {
    await deleteText(doc);
    return new Response(null, { status: 204 });
  }

  const input = (await request.json().catch(() => ({}))) as Partial<Record<keyof TextInput, unknown>>;
  const errors = checkTextInput(input);
  if (errors.length > 0) return Response.json({ errors }, { status: 400 });
  const { title, text, voice: key, translationModel: modelKey } = input as TextInput;
  const voice = findVoice(key);
  const model = findTranslationModel(modelKey);
  if (!voice || !model) return Response.json({ errors: ['Выберите голос и модель из списка.'] }, { status: 400 });

  const source = normalizeSource(text);
  const now = new Date().toISOString();
  // Texts saved before models could be chosen count as having the default one.
  const oldModel = doc.translation.preferred ? `${doc.translation.provider}:${doc.translation.preferred}` : DEFAULT_TRANSLATION_MODEL;
  const edited: TextDoc = {
    ...doc,
    title: title.trim(),
    tts: { provider: voice.provider, voice: voice.id },
    translation: { ...doc.translation, provider: model.provider, preferred: model.id },
  };
  // Voice and translation depend on the text, the voice and the model; a new title alone needs no new run.
  const sameVoice = key === voiceKey({ provider: doc.tts.provider, id: doc.tts.voice });
  if (source === doc.source && sameVoice && modelKey === oldModel) {
    await saveDoc(edited);
    return Response.json(edited);
  }
  const waiting: TextDoc = { ...edited, source, status: 'processing', updatedAt: now, audio: '', sentences: [] };
  delete waiting.error;
  const failure = await saveAndProcess(waiting);
  if (failure) return Response.json({ error: failure }, { status: 502 });
  return Response.json(waiting);
};

export const config: Config = { path: '/api/admin/texts/:id', method: ['GET', 'PATCH', 'DELETE'] };
