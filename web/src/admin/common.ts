// Shared parts of the admin pages: the login check, calls to the admin API, the top menu and small helpers.
// Every page decides what it shows; the admin API checks the login again on the server for every request.

import { getUser, logout } from '@netlify/identity';
import { canChange } from '../../../shared/new-text.ts';
import type { TextSummary } from '../../../shared/text-doc.ts';
import '../style.css';

/**
 * Finds a page element that the HTML must contain.
 * @param selector CSS selector.
 * @returns The element.
 * @throws If the HTML has no such element.
 */
export function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing ${selector}`);
  return found;
}

/**
 * Checks where to go after login. Only admin pages are allowed, so a crafted link
 * to the login page cannot send the admin to another site afterwards.
 * @param next The "next" value from the address, or null.
 * @returns A safe admin path.
 */
export function safeNext(next: string | null): string {
  return next && /^\/admin(\/|$|\?)/.test(next) && !next.startsWith('//') ? next : '/admin/';
}

/** Opens the login page and remembers the current page, to come back after login. */
export function goToLogin(): void {
  location.replace(`/admin/login?next=${encodeURIComponent(location.pathname + location.search)}`);
}

/**
 * Makes sure the admin is logged in in this browser; otherwise opens the login page.
 * The server still checks every request: this only avoids showing an empty page.
 * @returns Resolves when logged in; never resolves while the browser is leaving for the login page.
 */
export async function requireLogin(): Promise<void> {
  if (await getUser()) return;
  goToLogin();
  await new Promise(() => {});
}

/**
 * Runs an action with its button turned off, so a double tap cannot send it twice.
 * @param button The button that started the action.
 * @param action The action.
 */
export async function busy(button: HTMLButtonElement, action: () => Promise<void>): Promise<void> {
  button.disabled = true;
  try {
    await action();
  } finally {
    button.disabled = false;
  }
}

/** Answer of the admin API: whether it succeeded, its status and its JSON body. */
export interface ApiAnswer {
  ok: boolean;
  status: number;
  data: { error?: string; errors?: string[] } & Record<string, unknown>;
}

/**
 * Calls the admin API. "Not logged in" opens the login page, which brings the admin back here afterwards.
 * @param path API path.
 * @param method HTTP method.
 * @param body JSON body for POST and PATCH.
 * @returns The answer; a network failure is reported as status 0.
 */
export async function api(path: string, method = 'GET', body?: unknown): Promise<ApiAnswer> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, data: { error: 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.' } };
  }
  const data = (await response.json().catch(() => ({}))) as ApiAnswer['data'];
  if (response.status === 401) goToLogin();
  return { ok: response.ok, status: response.status, data };
}

/**
 * Describes what went wrong in an API answer.
 * @param answer A failed answer.
 * @returns A message in Russian.
 */
export function problemOf(answer: ApiAnswer): string {
  if (answer.data.errors?.length) return answer.data.errors.join(' ');
  return answer.data.error ?? `Ошибка сервера (${answer.status}). Попробуйте ещё раз.`;
}

/**
 * Describes a text's status in a few words.
 * @param text A text summary.
 * @returns The status in Russian.
 */
export function statusLabel(text: Pick<TextSummary, 'status' | 'createdAt' | 'updatedAt'>): string {
  if (text.status === 'ready') return 'Готов';
  if (text.status === 'error') return 'Ошибка';
  return canChange(text) ? 'Завис в обработке' : 'Обрабатывается…';
}

/**
 * Formats a date and time for the admin pages.
 * @param iso An ISO 8601 time.
 * @returns For example "14.10.2026, 21:40".
 */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
}

/** Admin page address of a text. */
export function adminTextUrl(id: string): string {
  return `/admin/texts/${encodeURIComponent(id)}`;
}

/** Connects the "Выйти" button of the top menu, if the page has one. */
export function setupMenu(): void {
  const button = document.querySelector<HTMLButtonElement>('#logout');
  button?.addEventListener('click', () => {
    void busy(button, async () => {
      await logout().catch(() => undefined);
      location.replace('/admin/login');
    });
  });
}

/**
 * Shows the page content in place of the "Загружаю…" line.
 * @param content The page's main block.
 */
export function showContent(content: HTMLElement): void {
  element<HTMLElement>('#loading').hidden = true;
  content.hidden = false;
}
