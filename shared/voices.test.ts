// Tests for the list of voices: keys, lookup and the default voice.

import { describe, expect, it } from 'vitest';
import { DEFAULT_VOICE, findVoice, VOICES, voiceKey } from './voices.ts';

describe('voices', () => {
  it('names a voice together with its provider', () => {
    expect(voiceKey({ provider: 'kokoro', id: 'am_liam' })).toBe('kokoro:am_liam');
  });

  it('finds an allowed voice by its key and nothing else', () => {
    expect(findVoice('kokoro:af_heart')).toMatchObject({ provider: 'kokoro', id: 'af_heart' });
    expect(findVoice('kokoro:bm_george')).toBeUndefined();
    expect(findVoice('am_liam')).toBeUndefined();
  });

  it('has the default voice in the list', () => {
    expect(findVoice(DEFAULT_VOICE)).toBeDefined();
  });

  it('has no voice twice', () => {
    const keys = VOICES.map(voiceKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
