// Admin page of one text: status, details, actions (open, edit, retry, delete) and the log of its last run.
// While the text is being processed, the page refreshes itself until the status changes.

import { canChange } from '../../../shared/new-text.ts';
import type { TextDoc } from '../../../shared/text-doc.ts';
import { translationModelLabel } from '../../../shared/translation-models.ts';
import { textPageUrl } from '../api.ts';
import { adminTextUrl, api, busy, element, formatDate, problemOf, requireLogin, setupMenu, showContent, statusLabel } from './common.ts';
import { logLines } from './process-log.ts';

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
const logSection = element<HTMLElement>('#log-section');
const logList = element<HTMLOListElement>('#log');

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

/**
 * Shows the steps of the last run, one per line, with the technical detail of a failure under it.
 * @param text The text; old texts have no log.
 */
function renderLog(text: TextDoc): void {
  const lines = logLines(text.log ?? []);
  // The admin started a run, but GitHub has not started the pipeline yet (that takes about a minute and a half).
  if (text.status === 'processing' && lines.length === 0) {
    lines.push({ time: '', text: 'Ждём запуска обработки на GitHub…', detail: '' });
  }
  logSection.hidden = lines.length === 0;
  logList.replaceChildren(
    ...lines.map((line) => {
      const item = document.createElement('li');
      const time = document.createElement('span');
      time.className = 'log-time';
      time.textContent = line.time;
      const body = document.createElement('div');
      const label = document.createElement('div');
      label.textContent = line.text;
      body.append(label);
      if (line.detail) {
        const technical = document.createElement('div');
        technical.className = 'log-detail';
        technical.textContent = line.detail;
        body.append(technical);
      }
      item.append(time, body);
      return item;
    }),
  );
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
  // The chosen model is tried first; if it failed, another one translated, and the page says so.
  const chosen = text.translation.preferred;
  const used = text.translation.model;
  if (chosen) detail('Модель перевода', translationModelLabel(chosen));
  if (used && used !== chosen) detail(chosen ? 'Перевела (запасная)' : 'Перевела', translationModelLabel(used));
  detail('Символов', String(text.source.length));
  if (text.status === 'ready') detail('Предложений', String(text.sentences.length));

  const changeable = canChange(text);
  // While a run works on the text there is nothing to do but wait, so the page says how long it has been.
  processingNote.hidden = changeable;
  const minutes = Math.floor((Date.now() - Date.parse(text.updatedAt ?? text.createdAt)) / 60_000);
  const elapsed = minutes < 1 ? 'Идёт меньше минуты' : `Идёт ${minutes} мин`;
  processingNote.textContent = `${elapsed}. Обычно 2–3 минуты; страница обновляется сама.`;
  renderLog(text);
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
      location.replace('/admin/');
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
