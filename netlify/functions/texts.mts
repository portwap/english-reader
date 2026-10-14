// API: GET /api/texts?offset&limit returns one page of ready texts, newest first, for the home page.
// Reads the text index: one request for the whole list, however many texts there are.

import { getStore } from '@netlify/blobs';
import type { Config } from '@netlify/functions';
import { TEXTS_STORE } from '../../shared/storage.ts';
import { INDEX_STORE, pageOf, pageRequestOf, readIndex, rebuildFrom } from '../../shared/text-index.ts';

/**
 * Lists ready texts.
 * @param request GET with optional offset and limit.
 * @returns {texts, total}: one page of TextSummary, newest first, and how many ready texts there are.
 */
export default async (request: Request): Promise<Response> => {
  const all = await readIndex(getStore(INDEX_STORE), rebuildFrom(getStore(TEXTS_STORE)));
  // Visitors see only ready texts and never search; the search is for the admin list.
  const page = pageOf(all, { ...pageRequestOf(request.url), query: '', readyOnly: true });
  // no-cache: a text that just became ready should appear at once.
  return Response.json(page, { headers: { 'Cache-Control': 'no-cache' } });
};

export const config: Config = { path: '/api/texts', method: 'GET' };
