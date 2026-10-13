// API: GET /api/texts/:id returns one text document (TextDoc) for the text page.

import { getStore } from '@netlify/blobs';
import type { Config, Context } from '@netlify/functions';
import { TEXTS_STORE } from '../../shared/storage.ts';

/**
 * Returns one text.
 * @param _request The HTTP request (unused).
 * @param context Holds the text id from the path.
 * @returns The TextDoc as JSON, or 404 if there is no such text.
 */
export default async (_request: Request, context: Context): Promise<Response> => {
  const doc = await getStore(TEXTS_STORE).get(context.params.id ?? '', { type: 'json' });
  if (!doc) return Response.json({ error: 'Text not found' }, { status: 404 });
  return Response.json(doc, { headers: { 'Cache-Control': 'no-cache' } });
};

export const config: Config = { path: '/api/texts/:id', method: 'GET' };
