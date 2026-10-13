// Writes processed texts to Netlify Blobs from outside Netlify (GitHub Actions).
// Needs the site ID and a Netlify personal access token, both given as settings, never in code.

import { getStore } from '@netlify/blobs';
import { AUDIO_STORE, TEXTS_STORE, summaryOf } from '../shared/storage.ts';
import type { TextDoc } from '../shared/text-doc.ts';

/** Where the pipeline saves its results. */
export interface TextStorage {
  /**
   * Saves a text document, replacing any older version.
   * @param doc The document.
   */
  saveDoc(doc: TextDoc): Promise<void>;
  /**
   * Saves a text's audio.
   * @param key Key from audioKey.
   * @param mp3 The mp3 file.
   */
  saveAudio(key: string, mp3: Buffer): Promise<void>;
}

/**
 * Connects to the site's Netlify Blobs storage.
 * @param siteID Netlify site (project) ID.
 * @param token Netlify personal access token.
 * @returns Storage that writes texts and audio.
 */
export function netlifyStorage(siteID: string, token: string): TextStorage {
  const texts = getStore(TEXTS_STORE, { siteID, token });
  const audio = getStore(AUDIO_STORE, { siteID, token });
  return {
    async saveDoc(doc) {
      await texts.setJSON(doc.id, doc, { metadata: { ...summaryOf(doc) } });
    },
    async saveAudio(key, mp3) {
      // Copy into a plain ArrayBuffer: a Buffer may be a view into a larger shared one.
      const bytes = mp3.buffer.slice(mp3.byteOffset, mp3.byteOffset + mp3.byteLength) as ArrayBuffer;
      await audio.set(key, bytes);
    },
  };
}
