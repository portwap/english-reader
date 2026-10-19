// Tests for the address the login page goes back to (only admin pages are allowed) and for busy buttons.

import { describe, expect, it, vi } from 'vitest';
import { busy, LEAVING, safeNext } from './common.ts';

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

describe('busy', () => {
  /** Stands for a button: busy only turns it off and on. */
  const button = () => ({ disabled: false }) as HTMLButtonElement;

  it('turns the button off while the action runs and on again afterwards, also after an error', async () => {
    const save = button();
    let offWhileRunning = false;
    await busy(save, async () => {
      offWhileRunning = save.disabled;
    });
    expect(offWhileRunning).toBe(true);
    expect(save.disabled).toBe(false);
    await expect(busy(save, async () => Promise.reject(new Error('down')))).rejects.toThrow('down');
    expect(save.disabled).toBe(false);
  });

  it('keeps the button off when the action opens another page, so a second tap cannot send it again', async () => {
    const save = button();
    await busy(save, async () => LEAVING);
    expect(save.disabled).toBe(true);
  });

  it('turns the button on again when "Back" brings the page back from the browser cache', async () => {
    const listeners: Record<string, () => void> = {};
    vi.stubGlobal('addEventListener', (type: string, listener: () => void) => void (listeners[type] = listener));
    try {
      const save = button();
      await busy(save, async () => LEAVING);
      listeners.pageshow?.();
      expect(save.disabled).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
