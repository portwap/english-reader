// API: GET /api/texts returns the ready texts, newest first, for the home page.
// Reads only the metadata of each entry, so the list stays fast however long the texts are.

import { getStore } from '@netlify/blobs';
import type { Config } from '@netlify/functions';
import { TEXTS_STORE } from '../../shared/storage.ts';
import type { TextSummary } from '../../shared/text-doc.ts';

/**
 * Lists ready texts.
 * @returns JSON array of TextSummary, newest first.
 */
export default async (): Promise<Response> => {
  const store = getStore(TEXTS_STORE);
  const { blobs } = await store.list();
  const summaries = await Promise.all(
    blobs.map(async ({ key }) => (await store.getMetadata(key))?.metadata as TextSummary | undefined),
  );
  const ready = summaries
    .filter((summary): summary is TextSummary => summary?.status === 'ready')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  // no-cache: a text that just became ready should appear at once.
  return Response.json(ready, { headers: { 'Cache-Control': 'no-cache' } });
};

export const config: Config = { path: '/api/texts', method: 'GET' };
