// Admin list of texts: search by title, "Показать ещё" and a page size that this browser remembers.
// While a text is being processed, the visible part of the list refreshes itself.

import { canChange } from '../../../shared/new-text.ts';
import type { TextSummary } from '../../../shared/text-doc.ts';
import { adminTextUrl, api, busy, element, formatDate, problemOf, requireLogin, setupMenu, showContent, statusLabel } from './common.ts';

const content = element<HTMLElement>('#content');
const search = element<HTMLInputElement>('#search');
const summary = element<HTMLParagraphElement>('#summary');
const list = element<HTMLUListElement>('#list');
const more = element<HTMLButtonElement>('#more');
const pageSize = element<HTMLSelectElement>('#page-size');
const message = element<HTMLParagraphElement>('#message');

/** Where this browser keeps the chosen page size. */
const PAGE_SIZE_KEY = 'admin-page-size';
const PAGE_SIZES = ['10', '20', '50'];
/** How often a list with texts in processing refreshes itself. */
const REFRESH_MS = 10_000;

let texts: TextSummary[] = [];
let total = 0;
let refreshTimer = 0;
/** Counts loads, so an answer to an older search never overwrites a newer one. */
let loadNumber = 0;

/**
 * Reads the remembered page size; browser storage may be unavailable, so 10 is the fallback.
 * @returns "10", "20" or "50".
 */
function savedPageSize(): string {
  try {
    const saved = localStorage.getItem(PAGE_SIZE_KEY);
    if (saved && PAGE_SIZES.includes(saved)) return saved;
  } catch {
    // Storage blocked: use the default.
  }
  return '10';
}

/** Shows the loaded texts, the count, and "Показать ещё" while more are left. */
function render(): void {
  list.replaceChildren(
    ...texts.map((text) => {
      const link = document.createElement('a');
      link.href = adminTextUrl(text.id);
      const title = document.createElement('span');
      title.className = 'item-title';
      title.textContent = text.title;
      const details = document.createElement('span');
      details.className = 'item-status';
      const badge = document.createElement('span');
      badge.className = `badge ${text.status}`;
      badge.textContent = statusLabel(text);
      details.append(badge, ` ${formatDate(text.createdAt)}`);
      link.append(title, details);
      const item = document.createElement('li');
      item.append(link);
      return item;
    }),
  );
  const query = search.value.trim();
  if (total === 0) summary.textContent = query ? 'Ничего не найдено.' : 'Текстов пока нет.';
  else summary.textContent = `${query ? 'Найдено' : 'Всего'}: ${total}. Показано: ${texts.length}.`;
  more.hidden = texts.length >= total;

  window.clearTimeout(refreshTimer);
  if (texts.some((text) => !canChange(text))) refreshTimer = window.setTimeout(() => void refresh(), REFRESH_MS);
}

/**
 * Loads texts from the server.
 * @param offset How many to skip.
 * @param limit How many to load.
 * @returns The page, or null if loading failed or a newer load started meanwhile.
 */
async function load(offset: number, limit: number): Promise<{ texts: TextSummary[]; total: number } | null> {
  const number = ++loadNumber;
  const query = encodeURIComponent(search.value.trim());
  const answer = await api(`/api/admin/texts?offset=${offset}&limit=${limit}&q=${query}`);
  if (number !== loadNumber) return null;
  if (!answer.ok) {
    message.textContent = problemOf(answer);
    return null;
  }
  message.textContent = '';
  return answer.data as unknown as { texts: TextSummary[]; total: number };
}

/** Loads the first page again, for a new search or page size. */
async function reload(): Promise<void> {
  const page = await load(0, Number(pageSize.value));
  if (!page) return;
  texts = page.texts;
  total = page.total;
  render();
}

/** Refreshes the texts already shown; new texts in processing are the newest, so they are always among them. */
async function refresh(): Promise<void> {
  const page = await load(0, Math.max(texts.length, Number(pageSize.value)));
  if (!page) return;
  texts = page.texts;
  total = page.total;
  render();
}

more.addEventListener('click', () => {
  void busy(more, async () => {
    const page = await load(texts.length, Number(pageSize.value));
    if (!page) return;
    texts = [...texts, ...page.texts.filter((text) => !texts.some((shown) => shown.id === text.id))];
    total = page.total;
    render();
  });
});

pageSize.addEventListener('change', () => {
  try {
    localStorage.setItem(PAGE_SIZE_KEY, pageSize.value);
  } catch {
    // Storage blocked: the size applies to this visit only.
  }
  void reload();
});

let searchTimer = 0;
search.addEventListener('input', () => {
  // Waits until typing pauses, so the server is not asked after every letter.
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => void reload(), 300);
});

/** Checks the login, then shows the first page. */
async function start(): Promise<void> {
  await requireLogin();
  setupMenu();
  pageSize.value = savedPageSize();
  await reload();
  showContent(content);
}

void start();
