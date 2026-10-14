// Tests for spotting an admin session from the cookies, which decides whether the admin bar is shown.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasAdminSession } from './admin-bar.ts';

/** Pretends the browser has these cookies. */
function cookies(value: string): void {
  vi.stubGlobal('document', { cookie: value });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('hasAdminSession', () => {
  it('sees the session cookie wherever it is in the list', () => {
    cookies('nf_jwt=abc');
    expect(hasAdminSession()).toBe(true);
    cookies('theme=dark; nf_jwt=abc; x=1');
    expect(hasAdminSession()).toBe(true);
  });

  it('is not fooled by a cookie whose name only ends the same way', () => {
    cookies('other_nf_jwt=abc');
    expect(hasAdminSession()).toBe(false);
    cookies('');
    expect(hasAdminSession()).toBe(false);
  });
});
