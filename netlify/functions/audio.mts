// API: GET /api/audio/:id returns the mp3 of a text.
// The file is streamed: buffered function responses are limited to 6 MB, streamed ones to 20 MB.

import { getStore } from '@netlify/blobs';
import type { Config, Context } from '@netlify/functions';
import { AUDIO_STORE, audioKey } from '../../shared/storage.ts';

/**
 * Returns the audio of one text.
 * @param _request The HTTP request (unused).
 * @param context Holds the text id from the path.
 * @returns The mp3 as a stream, or 404 if there is no audio for this id.
 */
export default async (_request: Request, context: Context): Promise<Response> => {
  const stream = await getStore(AUDIO_STORE).get(audioKey(context.params.id ?? ''), { type: 'stream' });
  if (!stream) return Response.json({ error: 'Audio not found' }, { status: 404 });
  // no-cache: processing a changed text again keeps the same key, so the browser must check for a new file.
  return new Response(stream, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-cache' } });
};

export const config: Config = { path: '/api/audio/:id', method: 'GET' };
