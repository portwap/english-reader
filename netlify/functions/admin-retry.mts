// Admin API: POST /api/admin/texts/:id/retry processes a text again after an error, or after it got stuck.
// Only the logged-in admin may call it.

import type { Config, Context } from '@netlify/functions';
import { canChange, ID_PATTERN } from '../../shared/new-text.ts';
import type { TextDoc } from '../../shared/text-doc.ts';
import { checkAdmin } from '../lib/auth.ts';
import { loadDoc, saveAndProcess } from '../lib/texts.ts';

/**
 * Starts processing a text again.
 * @param request POST.
 * @param context Holds the text id from the path.
 * @returns 202 with the TextDoc now "processing"; 404 if there is no such text; 409 if it is ready or still
 *   being processed; 502 with {error} if processing could not start.
 */
export default async (request: Request, context: Context): Promise<Response> => {
  const denied = await checkAdmin(request, true);
  if (denied) return denied;

  const id = context.params.id ?? '';
  const doc = ID_PATTERN.test(id) ? await loadDoc(id) : null;
  if (!doc) return Response.json({ error: 'Такого текста нет.' }, { status: 404 });
  if (doc.status === 'ready' || !canChange(doc)) {
    return Response.json({ error: 'Повтор нужен только тексту с ошибкой или зависшему.' }, { status: 409 });
  }

  const waiting: TextDoc = { ...doc, status: 'processing', updatedAt: new Date().toISOString() };
  delete waiting.error;
  const failure = await saveAndProcess(waiting);
  if (failure) return Response.json({ error: failure }, { status: 502 });
  return Response.json(waiting, { status: 202 });
};

export const config: Config = { path: '/api/admin/texts/:id/retry', method: 'POST' };
