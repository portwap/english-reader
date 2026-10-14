// Tests for the address the login page goes back to: only admin pages are allowed.

import { describe, expect, it } from 'vitest';
import { safeNext } from './common.ts';

describe('safeNext', () => {
  it('goes back to the admin page that was asked for', () => {
    expect(safeNext('/admin')).toBe('/admin');
    expect(safeNext('/admin/texts/a-1/edit')).toBe('/admin/texts/a-1/edit');
    expect(safeNext('/admin?q=cat')).toBe('/admin?q=cat');
  });

  it('refuses addresses outside the admin pages, so a crafted link cannot lead to another site', () => {
    for (const bad of [null, '', 'https://evil.example/admin', '//evil.example/admin', '/administrator', '/texts/a', '/']) {
      expect(safeNext(bad)).toBe('/admin/');
    }
  });
});
