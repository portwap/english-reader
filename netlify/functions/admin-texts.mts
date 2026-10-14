// Admin API: GET /api/admin/texts lists all texts with their status; POST /api/admin/texts adds a text
// and starts its processing. Only the logged-in admin may call it.

import type { Config } from '@netlify/functions';
import { checkTextInput, newTextDoc, type TextInput } from '../../shared/new-text.ts';
import { checkAdmin } from '../lib/auth.ts';
import { listTexts, saveAndProcess } from '../lib/texts.ts';

/**
 * Lists texts or adds one.
 * @param request GET, or POST with JSON {title, text, voice}.
 * @returns GET: JSON array of TextSummary. POST: 201 with {id}; 400 with {errors} for bad input;
 *   502 with {error, id} if the text was saved but its processing could not start.
 */
export default async (request: Request): Promise<Response> => {
  const denied = await checkAdmin(request, request.method !== 'GET');
  if (denied) return denied;

  if (request.method === 'GET') {
    return Response.json(await listTexts(), { headers: { 'Cache-Control': 'no-store' } });
  }

  const input = (await request.json().catch(() => ({}))) as Partial<Record<keyof TextInput, unknown>>;
  const errors = checkTextInput(input);
  if (errors.length > 0) return Response.json({ errors }, { status: 400 });

  const doc = newTextDoc(input as TextInput);
  const failure = await saveAndProcess(doc);
  if (failure) return Response.json({ error: failure, id: doc.id }, { status: 502 });
  return Response.json({ id: doc.id }, { status: 201 });
};

export const config: Config = { path: '/api/admin/texts', method: ['GET', 'POST'] };
