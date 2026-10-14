// Tests for the text index: safe concurrent updates, building a missing index, and paging.

import { describe, expect, it } from 'vitest';
import type { TextSummary } from './text-doc.ts';
import { type IndexStore, type WriteCondition, pageOf, pageRequestOf, readIndex, removeSummary, updateIndex, upsertSummary } from './text-index.ts';

/** Makes a summary; the date sets the order. */
function text(id: string, day: number, status: TextSummary['status'] = 'ready', title = id): TextSummary {
  return { id, title, status, createdAt: `2026-10-${String(day).padStart(2, '0')}T10:00:00.000Z` };
}

/** A store that keeps one value with a version tag, like Netlify Blobs with conditional writes. */
class FakeStore implements IndexStore {
  value: unknown = null;
  version = 0;
  /** Called after each read, to let a test slip in another writer. */
  afterRead: () => void = () => {};

  async getWithMetadata() {
    const result = this.value === null ? null : { data: structuredClone(this.value), etag: `v${this.version}` };
    this.afterRead();
    return result;
  }

  async setJSON(_key: string, data: unknown, options: WriteCondition) {
    if ('onlyIfNew' in options && this.value !== null) return { modified: false };
    if ('onlyIfMatch' in options && options.onlyIfMatch !== `v${this.version}`) return { modified: false };
    this.value = structuredClone(data);
    this.version++;
    return { modified: true };
  }
}

const texts = (store: FakeStore) => (store.value as { texts: TextSummary[] }).texts.map((t) => t.id);

describe('upsertSummary and removeSummary', () => {
  it('replaces a text with the same id and keeps the newest first', () => {
    const list = upsertSummary([text('a', 1), text('b', 3)], text('a', 5, 'error'));
    expect(list.map((t) => [t.id, t.status])).toEqual([
      ['a', 'error'],
      ['b', 'ready'],
    ]);
    expect(removeSummary(list, 'a').map((t) => t.id)).toEqual(['b']);
  });
});

describe('updateIndex', () => {
  it('builds a missing index from the texts, then applies the change', async () => {
    const store = new FakeStore();
    await updateIndex(store, (list) => upsertSummary(list, text('new', 9)), async () => [text('old', 1)]);
    expect(texts(store)).toEqual(['new', 'old']);
  });

  it('does not lose a change when another writer saved in between', async () => {
    const store = new FakeStore();
    store.value = { version: 1, texts: [text('a', 1)] };
    let first = true;
    store.afterRead = () => {
      if (!first) return;
      first = false;
      // Another writer adds "b" right after our read.
      store.value = { version: 1, texts: [text('b', 2), text('a', 1)] };
      store.version++;
    };
    await updateIndex(store, (list) => upsertSummary(list, text('c', 3)), async () => []);
    expect(texts(store)).toEqual(['c', 'b', 'a']);
  });

  it('gives up with an error if the index keeps changing', async () => {
    const store = new FakeStore();
    store.value = { version: 1, texts: [] };
    store.afterRead = () => void store.version++;
    await expect(updateIndex(store, (list) => list, async () => [])).rejects.toThrow(/kept changing/);
  });
});

describe('readIndex', () => {
  it('builds and saves a missing index once', async () => {
    const store = new FakeStore();
    let rebuilds = 0;
    const rebuild = async () => {
      rebuilds++;
      return [text('a', 1), text('b', 2)];
    };
    expect((await readIndex(store, rebuild)).map((t) => t.id)).toEqual(['b', 'a']);
    expect((await readIndex(store, rebuild)).map((t) => t.id)).toEqual(['b', 'a']);
    expect(rebuilds).toBe(1);
  });
});

describe('pageOf', () => {
  const all = [text('e', 5), text('d', 4, 'processing'), text('c', 3, 'ready', 'Self-Belief'), text('b', 2), text('a', 1)];

  it('returns one page and the total', () => {
    expect(pageOf(all, { offset: 1, limit: 2 })).toMatchObject({ total: 5, texts: [{ id: 'd' }, { id: 'c' }] });
  });

  it('shows only ready texts on the public site', () => {
    expect(pageOf(all, { offset: 0, limit: 10, readyOnly: true }).total).toBe(4);
  });

  it('finds texts by a part of the title, ignoring case', () => {
    expect(pageOf(all, { offset: 0, limit: 10, query: ' self ' }).texts.map((t) => t.id)).toEqual(['c']);
  });

  it('brings page numbers into range and uses 10 for a missing or zero size', () => {
    expect(pageOf(all, { offset: -3, limit: 1000 }).texts).toHaveLength(5);
    const many = Array.from({ length: 60 }, (_, i) => text(`t${i}`, 1));
    expect(pageOf(many, { offset: 0, limit: 1000 }).texts).toHaveLength(50);
    expect(pageOf(many, { offset: Number.NaN, limit: Number.NaN }).texts).toHaveLength(10);
    expect(pageOf(many, { offset: 0, limit: 0 }).texts).toHaveLength(10);
  });
});

describe('pageRequestOf', () => {
  it('reads offset, limit and the search from the address', () => {
    expect(pageRequestOf('https://x/api/texts?offset=20&limit=10&q=cat')).toEqual({ offset: 20, limit: 10, query: 'cat' });
    expect(pageRequestOf('https://x/api/texts')).toEqual({ offset: 0, limit: 10, query: '' });
  });
});
