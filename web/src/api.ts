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

/** One page of a list of texts, and how many there are in total. */
export interface TextPage {
  texts: TextSummary[];
  total: number;
}

/**
 * Lists one page of ready texts, newest first.
 * @param offset How many texts to skip.
 * @param limit How many texts to return.
 * @returns The page and the total number of ready texts.
 */
export function fetchTexts(offset: number, limit: number): Promise<TextPage> {
  return getJson(`/api/texts?offset=${offset}&limit=${limit}`);
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
