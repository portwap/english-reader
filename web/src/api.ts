// Reads texts from the site's API; the only place the pages know the API addresses.

import type { TextDoc, TextSummary } from '../../shared/text-doc.ts';

/**
 * Fetches JSON and turns HTTP errors into clear messages.
 * @param url API address.
 * @returns The parsed JSON.
 * @throws With the HTTP status if the request failed.
 */
async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (response.status === 404) throw new Error('not-found');
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as T;
}

/**
 * Lists the ready texts, newest first.
 * @returns Text summaries.
 */
export function fetchTexts(): Promise<TextSummary[]> {
  return getJson('/api/texts');
}

/**
 * Fetches one text.
 * @param id Text id.
 * @returns The text document.
 * @throws Error('not-found') if there is no such text.
 */
export function fetchText(id: string): Promise<TextDoc> {
  return getJson(`/api/texts/${encodeURIComponent(id)}`);
}

/**
 * Gives the address of a text's audio.
 * @param id Text id.
 * @returns The mp3 address.
 */
export function audioUrl(id: string): string {
  return `/api/audio/${encodeURIComponent(id)}`;
}

/**
 * Gives the address of a text's page.
 * @param id Text id.
 * @returns The page address.
 */
export function textPageUrl(id: string): string {
  return `/texts/${encodeURIComponent(id)}`;
}
