// The index: one stored list with the summary of every text, so a list of texts is read with one request
// instead of one request per text. Every writer changes it through updateIndex, which retries if someone
// else wrote it in between, so no change is lost.

import type { TextSummary } from './text-doc.ts';

/** Store and key of the index. */
export const INDEX_STORE = 'index';
export const INDEX_KEY = 'texts';

/** What is stored under INDEX_KEY. */
export interface TextIndex {
  version: 1;
  /** Newest first. */
  texts: TextSummary[];
}

/** A write condition: overwrite only this exact version, or create only if nothing is there. */
export type WriteCondition = { onlyIfMatch: string } | { onlyIfNew: true };

/** The two store calls the index needs; a small interface keeps this file testable with a fake store. */
export interface IndexStore {
  getWithMetadata(key: string, options: { type: 'json' }): Promise<{ data: unknown; etag?: string } | null>;
  setJSON(key: string, data: unknown, options: WriteCondition): Promise<{ modified: boolean }>;
}

/** Reads the summaries of all texts the slow way; used once, when the index does not exist yet. */
export type RebuildIndex = () => Promise<TextSummary[]>;

/** The two calls on the texts store that rebuilding the index needs. */
export interface TextsMetadataStore {
  list(): Promise<{ blobs: { key: string }[] }>;
  getMetadata(key: string): Promise<{ metadata: Record<string, unknown> } | null>;
}

/**
 * Makes a rebuild that reads every text's summary from its metadata: one request per text, so only for a missing index.
 * @param texts The texts store.
 * @returns The rebuild function.
 */
export function rebuildFrom(texts: TextsMetadataStore): RebuildIndex {
  return async () => {
    const { blobs } = await texts.list();
    const summaries = await Promise.all(
      blobs.map(async ({ key }) => (await texts.getMetadata(key))?.metadata as TextSummary | undefined),
    );
    return summaries.filter((summary): summary is TextSummary => Boolean(summary?.id));
  };
}

/** How many times a write is tried again when another writer changed the index first. */
const ATTEMPTS = 5;

/**
 * Sorts summaries newest first.
 * @param texts Summaries in any order.
 * @returns A new array, newest first.
 */
function newestFirst(texts: TextSummary[]): TextSummary[] {
  return [...texts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Adds a text's summary to a list, or replaces the old one.
 * @param texts Current summaries.
 * @param summary The new summary.
 * @returns A new list, newest first.
 */
export function upsertSummary(texts: TextSummary[], summary: TextSummary): TextSummary[] {
  return newestFirst([...texts.filter((text) => text.id !== summary.id), summary]);
}

/**
 * Removes a text's summary from a list.
 * @param texts Current summaries.
 * @param id Text id.
 * @returns A new list without that text.
 */
export function removeSummary(texts: TextSummary[], id: string): TextSummary[] {
  return texts.filter((text) => text.id !== id);
}

/**
 * Reads the summaries from a stored index value.
 * @param data What the store returned.
 * @returns The summaries, or null if the value is not an index.
 */
function textsOf(data: unknown): TextSummary[] | null {
  const index = data as Partial<TextIndex> | null;
  return index?.version === 1 && Array.isArray(index.texts) ? index.texts : null;
}

/**
 * Changes the index safely: reads it, applies the change, and writes it only if nobody wrote in between;
 * otherwise reads it again and repeats. A missing index is first built from the texts themselves.
 * @param store The index store.
 * @param change Turns the current summaries into the new ones.
 * @param rebuild Reads all summaries, for a missing index.
 * @throws If the index kept changing under every attempt.
 */
export async function updateIndex(
  store: IndexStore,
  change: (texts: TextSummary[]) => TextSummary[],
  rebuild: RebuildIndex,
): Promise<void> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const current = await store.getWithMetadata(INDEX_KEY, { type: 'json' });
    const texts = (current && textsOf(current.data)) ?? newestFirst(await rebuild());
    const next: TextIndex = { version: 1, texts: newestFirst(change(texts)) };
    // Write only over the exact version that was read; a new index only if none appeared meanwhile.
    const condition: WriteCondition = current?.etag ? { onlyIfMatch: current.etag } : { onlyIfNew: true };
    if ((await store.setJSON(INDEX_KEY, next, condition)).modified) return;
  }
  throw new Error('The text index kept changing; the change was not saved.');
}

/**
 * Reads all summaries, building and saving the index first if it does not exist.
 * @param store The index store.
 * @param rebuild Reads all summaries, for a missing index.
 * @returns All summaries, newest first.
 */
export async function readIndex(store: IndexStore, rebuild: RebuildIndex): Promise<TextSummary[]> {
  const current = await store.getWithMetadata(INDEX_KEY, { type: 'json' });
  const texts = current && textsOf(current.data);
  if (texts) return texts;
  const built = newestFirst(await rebuild());
  // If another request saved an index meanwhile, its version is kept; this one is just as good to show now.
  await store.setJSON(INDEX_KEY, { version: 1, texts: built } satisfies TextIndex, { onlyIfNew: true });
  return built;
}

/** Which part of a list to return. */
export interface PageRequest {
  offset: number;
  limit: number;
  /** Only texts whose title contains this, ignoring case. */
  query?: string;
  /** Only texts with status "ready" (the public site). */
  readyOnly?: boolean;
}

/** Largest page anyone may ask for, so one request cannot pull the whole index. */
export const MAX_PAGE_SIZE = 50;

/**
 * Cuts one page out of a list of summaries.
 * @param texts All summaries, newest first.
 * @param request Which page; numbers out of range are brought into range.
 * @returns The page and how many texts match in total.
 */
export function pageOf(texts: TextSummary[], request: PageRequest): { texts: TextSummary[]; total: number } {
  const query = request.query?.trim().toLowerCase() ?? '';
  const matching = texts.filter(
    (text) => (!request.readyOnly || text.status === 'ready') && (!query || text.title.toLowerCase().includes(query)),
  );
  const offset = Math.max(0, Math.floor(request.offset) || 0);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(request.limit) || 10));
  return { texts: matching.slice(offset, offset + limit), total: matching.length };
}

/**
 * Reads page settings from an address's query string: offset, limit and q.
 * @param url The request address.
 * @returns The page request (readyOnly is left for the caller).
 */
export function pageRequestOf(url: string): PageRequest {
  const params = new URL(url).searchParams;
  return {
    offset: Number(params.get('offset') ?? 0),
    limit: Number(params.get('limit') ?? 10),
    query: params.get('q') ?? '',
  };
}
