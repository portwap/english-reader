// Tests for voice selection: the default, a valid setting, and a clear error for a wrong one.

import { describe, expect, it } from 'vitest';
import { DEFAULT_VOICE, VOICES, resolveVoice } from './voices.ts';

describe('resolveVoice', () => {
  it('uses the default voice when the setting is missing or empty', () => {
    expect(resolveVoice(undefined)).toBe('am_liam');
    expect(resolveVoice('')).toBe('am_liam');
    expect(resolveVoice('  ')).toBe('am_liam');
  });

  it('returns an allowed voice from the setting', () => {
    expect(resolveVoice('af_heart')).toBe('af_heart');
    expect(resolveVoice(' am_eric ')).toBe('am_eric');
  });

  it('rejects a voice that is not in the list and names the allowed ones', () => {
    expect(() => resolveVoice('bm_george')).toThrow(/Unknown voice "bm_george".*am_liam/);
  });

  it('has the default voice in the list', () => {
    expect(VOICES.map((option) => option.id)).toContain(DEFAULT_VOICE);
  });
});
