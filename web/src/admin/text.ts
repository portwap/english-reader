// Admin page of one text: status, details and actions (open, edit, retry, delete).
// While the text is being processed, the page refreshes itself until the status changes.

import { canChange } from '../../../shared/new-text.ts';
import type { TextDoc } from '../../../shared/text-doc.ts';
import { textPageUrl } from '../api.ts';
import { adminTextUrl, api, busy, element, formatDate, problemOf, requireLogin, setupMenu, showContent, statusLabel } from './common.ts';

const content = element<HTMLElement>('#content');
const title = element<HTMLHeadingElement>('#title');
const status = element<HTMLSpanElement>('#status');
const errorBox = element<HTMLParagraphElement>('#error');
const processingNote = element<HTMLParagraphElement>('#processing');
const details = element<HTMLDListElement>('#details');
const open = element<HTMLAnchorElement>('#open');
const edit = element<HTMLAnchorElement>('#edit');
const retry = element<HTMLButtonElement>('#retry');
const remove = element<HTMLButtonElement>('#delete');
const message = element<HTMLParagraphElement>('#message');

/** How often the page checks a text that is being processed. */
const REFRESH_MS = 5_000;

const id = decodeURIComponent(/^\/admin\/texts\/([^/]+)/.exec(location.pathname)?.[1] ?? '');
let doc: TextDoc | null = null;
let refreshTimer = 0;

/**
 * Adds one line to the details list.
 * @param term What it is.
 * @param value Its value.
 */
function detail(term: string, value: string): void {
  const dt = document.createElement('dt');
  dt.textContent = term;
  const dd = document.createElement('dd');
  dd.textContent = value;
  details.append(dt, dd);
}

/** Shows the text's status, details and the actions that make sense for it now. */
function render(text: TextDoc): void {
  document.title = `${text.title} · English Reader`;
  title.textContent = text.title;
  status.className = `badge ${text.status}`;
  status.textContent = statusLabel(text);
  errorBox.hidden = text.status !== 'error';
  errorBox.textContent = text.error ?? '';

  details.replaceChildren();
  detail('Добавлен', formatDate(text.createdAt));
  if (text.updatedAt) detail('Изменён', formatDate(text.updatedAt));
  detail('Голос', `${text.tts.voice} (${text.tts.provider})`);
  if (text.translation.model) detail('Перевод', text.translation.model);
  detail('Символов', String(text.source.length));
  if (text.status === 'ready') detail('Предложений', String(text.sentences.length));

  const changeable = canChange(text);
  // While a run works on the text there is nothing to do but wait, so the page says how long.
  processingNote.hidden = changeable;
  open.hidden = text.status !== 'ready';
  open.href = textPageUrl(text.id);
  edit.hidden = !changeable;
  edit.href = `${adminTextUrl(text.id)}/edit`;
  retry.hidden = !changeable || text.status === 'ready';
  remove.hidden = !changeable;

  window.clearTimeout(refreshTimer);
  if (!changeable) refreshTimer = window.setTimeout(() => void load(), REFRESH_MS);
}

/**
 * Loads the text and shows it.
 * @returns False if the text could not be loaded.
 */
async function load(): Promise<boolean> {
  const answer = await api(`/api/admin/texts/${encodeURIComponent(id)}`);
  if (!answer.ok) {
    message.textContent = problemOf(answer);
    return false;
  }
  doc = answer.data as unknown as TextDoc;
  render(doc);
  return true;
}

retry.addEventListener('click', () => {
  void busy(retry, async () => {
    const answer = await api(`/api/admin/texts/${encodeURIComponent(id)}/retry`, 'POST');
    message.textContent = answer.ok ? 'Обработка запущена заново.' : problemOf(answer);
    await load();
  });
});

remove.addEventListener('click', () => {
  if (!doc || !window.confirm(`Удалить «${doc.title}»? Текст и его звук будут удалены навсегда.`)) return;
  void busy(remove, async () => {
    const answer = await api(`/api/admin/texts/${encodeURIComponent(id)}`, 'DELETE');
    if (answer.ok) {
      location.replace('/admin');
      return;
    }
    message.textContent = problemOf(answer);
  });
});

/** Checks the login, then loads the text. */
async function start(): Promise<void> {
  await requireLogin();
  setupMenu();
  if (!(await load())) title.textContent = 'Текст';
  showContent(content);
}

void start();
