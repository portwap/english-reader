// Admin page: login through Netlify Identity, adding, editing, retrying and deleting texts.
// The page only shows controls; every action is checked again on the server by the admin API.

import { acceptInvite, getUser, handleAuthCallback, login, logout } from '@netlify/identity';
import { canChange, MAX_TEXT_LENGTH } from '../../shared/new-text.ts';
import type { TextDoc, TextSummary } from '../../shared/text-doc.ts';
import { DEFAULT_VOICE, findVoice, VOICES, voiceKey } from '../../shared/voices.ts';
import { textPageUrl } from './api.ts';
import './style.css';

/**
 * Finds a page element that the HTML must contain.
 * @param selector CSS selector.
 * @returns The element.
 * @throws If the HTML has no such element.
 */
function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing ${selector}`);
  return found;
}

const statusBox = element<HTMLParagraphElement>('#status');
const passwordForm = element<HTMLFormElement>('#password-form');
const loginForm = element<HTMLFormElement>('#login-form');
const panel = element<HTMLElement>('#panel');
const textForm = element<HTMLFormElement>('#text-form');
const titleInput = element<HTMLInputElement>('#title');
const textInput = element<HTMLTextAreaElement>('#text');
const voiceSelect = element<HTMLSelectElement>('#voice');
const counter = element<HTMLParagraphElement>('#counter');
const formHeading = element<HTMLHeadingElement>('#form-heading');
const saveButton = element<HTMLButtonElement>('#save');
const cancelButton = element<HTMLButtonElement>('#cancel');
const formMessage = element<HTMLParagraphElement>('#form-message');
const list = element<HTMLUListElement>('#list');

/** Remembers the last chosen voice in this browser, so the next text gets it by default. */
const VOICE_KEY = 'admin-voice';

/** Id of the text being edited, or null when the form adds a new text. */
let editingId: string | null = null;
let refreshTimer = 0;

/**
 * Shows one of the page's views and hides the others.
 * @param view Which view to show.
 */
function show(view: 'status' | 'password' | 'login' | 'panel'): void {
  statusBox.hidden = view !== 'status';
  passwordForm.hidden = view !== 'password';
  loginForm.hidden = view !== 'login';
  panel.hidden = view !== 'panel';
}

/** Answer of the admin API: whether it succeeded, its status and its JSON body. */
interface ApiAnswer {
  ok: boolean;
  status: number;
  data: { error?: string; errors?: string[] } & Record<string, unknown>;
}

/**
 * Calls the admin API. A "not logged in" answer brings back the login form.
 * @param path API path.
 * @param method HTTP method.
 * @param body JSON body for POST and PATCH.
 * @returns The answer.
 */
async function api(path: string, method = 'GET', body?: unknown): Promise<ApiAnswer> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as ApiAnswer['data'];
  if (response.status === 401) showLogin();
  return { ok: response.ok, status: response.status, data };
}

/**
 * Describes what went wrong in an API answer, for the form.
 * @param answer A failed answer.
 * @returns A message in Russian.
 */
function problemOf(answer: ApiAnswer): string {
  if (answer.data.errors?.length) return answer.data.errors.join(' ');
  return answer.data.error ?? `Ошибка сервера (${answer.status}). Попробуйте ещё раз.`;
}

/** Updates the character counter under the text field. */
function updateCounter(): void {
  const length = textInput.value.trim().length;
  counter.textContent = `${length} / ${MAX_TEXT_LENGTH}`;
  counter.classList.toggle('over', length > MAX_TEXT_LENGTH);
}

/** Puts the form back into "new text" mode, keeping the chosen voice. */
function resetForm(): void {
  editingId = null;
  textForm.reset();
  voiceSelect.value = savedVoice();
  formHeading.textContent = 'Новый текст';
  saveButton.textContent = 'Создать';
  cancelButton.hidden = true;
  updateCounter();
}

/**
 * Reads the last chosen voice; browser storage may be unavailable, so the default is the fallback.
 * @returns A voice key from the list.
 */
function savedVoice(): string {
  try {
    const saved = localStorage.getItem(VOICE_KEY);
    if (saved && findVoice(saved)) return saved;
  } catch {
    // Storage blocked: use the default.
  }
  return DEFAULT_VOICE;
}

/**
 * Describes a text's status for the list.
 * @param text A text summary.
 * @returns A short status in Russian.
 */
function statusText(text: TextSummary): string {
  if (text.status === 'ready') return 'Готов';
  if (text.status === 'error') return `Ошибка: ${text.error ?? 'неизвестная'}`;
  return canChange(text) ? 'Завис в обработке' : 'Обрабатывается…';
}

/**
 * Makes a small button for a list item.
 * @param label Button text.
 * @param action What the button does.
 * @returns The button.
 */
function smallButton(label: string, action: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', action);
  return button;
}

/**
 * Shows the list of texts. While some text is being processed, the list reloads itself.
 * @param texts All texts, newest first.
 */
function renderList(texts: TextSummary[]): void {
  list.replaceChildren();
  if (texts.length === 0) {
    const empty = document.createElement('li');
    empty.textContent = 'Текстов пока нет.';
    list.append(empty);
  }
  for (const text of texts) {
    const item = document.createElement('li');
    const title = document.createElement(text.status === 'ready' ? 'a' : 'span');
    title.className = 'item-title';
    title.textContent = text.title;
    if (title instanceof HTMLAnchorElement) title.href = textPageUrl(text.id);
    const details = document.createElement('p');
    details.className = `item-status ${text.status}`;
    details.textContent = `${new Date(text.createdAt).toLocaleString('ru-RU')} · ${statusText(text)}`;
    const buttons = document.createElement('div');
    buttons.className = 'item-buttons';
    if (canChange(text)) {
      buttons.append(smallButton('Изменить', () => void startEdit(text.id)));
      if (text.status !== 'ready') buttons.append(smallButton('Повторить', () => void retry(text.id)));
      buttons.append(smallButton('Удалить', () => void remove(text)));
    }
    item.append(title, details, buttons);
    list.append(item);
  }

  window.clearTimeout(refreshTimer);
  if (texts.some((text) => !canChange(text))) refreshTimer = window.setTimeout(() => void loadList(), 10_000);
}

/** Loads and shows the list of texts. */
async function loadList(): Promise<void> {
  const answer = await api('/api/admin/texts');
  if (answer.ok) renderList(answer.data as unknown as TextSummary[]);
  else if (answer.status !== 401) formMessage.textContent = problemOf(answer);
}

/**
 * Fills the form with a text, to edit it.
 * @param id Text id.
 */
async function startEdit(id: string): Promise<void> {
  const answer = await api(`/api/admin/texts/${encodeURIComponent(id)}`);
  if (!answer.ok) {
    formMessage.textContent = problemOf(answer);
    return;
  }
  const doc = answer.data as unknown as TextDoc;
  editingId = doc.id;
  titleInput.value = doc.title;
  textInput.value = doc.source;
  voiceSelect.value = voiceKey({ provider: doc.tts.provider, id: doc.tts.voice });
  formHeading.textContent = 'Изменить текст';
  saveButton.textContent = 'Сохранить';
  cancelButton.hidden = false;
  formMessage.textContent = 'Новое название сохранится сразу; изменённый текст или голос обработается заново.';
  updateCounter();
  textForm.scrollIntoView({ behavior: 'smooth' });
}

/**
 * Starts processing a text again.
 * @param id Text id.
 */
async function retry(id: string): Promise<void> {
  const answer = await api(`/api/admin/texts/${encodeURIComponent(id)}/retry`, 'POST');
  formMessage.textContent = answer.ok ? 'Обработка запущена заново.' : problemOf(answer);
  await loadList();
}

/**
 * Deletes a text after asking.
 * @param text The text.
 */
async function remove(text: TextSummary): Promise<void> {
  if (!window.confirm(`Удалить «${text.title}»? Текст и его звук будут удалены навсегда.`)) return;
  const answer = await api(`/api/admin/texts/${encodeURIComponent(text.id)}`, 'DELETE');
  formMessage.textContent = answer.ok ? `«${text.title}» удалён.` : problemOf(answer);
  if (answer.ok && editingId === text.id) resetForm();
  await loadList();
}

/** Shows the admin panel and loads the texts. */
function showPanel(): void {
  show('panel');
  resetForm();
  void loadList();
}

/** Shows the login form. */
function showLogin(): void {
  window.clearTimeout(refreshTimer);
  show('login');
}

/**
 * Shows the "set your password" form for an invite and logs in once the password is set.
 * @param token Invite token from the email link.
 */
function showPasswordForm(token: string): void {
  show('password');
  const message = element<HTMLParagraphElement>('#password-message');
  passwordForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const password = element<HTMLInputElement>('#new-password').value;
    if (password !== element<HTMLInputElement>('#new-password-again').value) {
      message.textContent = 'Пароли не совпадают.';
      return;
    }
    message.textContent = 'Сохраняю…';
    acceptInvite(token, password)
      .then(() => showPanel())
      .catch(() => {
        message.textContent = 'Не получилось. Возможно, приглашение устарело: попросите новое в Netlify.';
      });
  });
}

loginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const message = element<HTMLParagraphElement>('#login-message');
  message.textContent = 'Вхожу…';
  login(element<HTMLInputElement>('#email').value, element<HTMLInputElement>('#password').value)
    .then(() => {
      message.textContent = '';
      showPanel();
    })
    .catch(() => {
      message.textContent = 'Неверная почта или пароль.';
    });
});

textForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const body = { title: titleInput.value, text: textInput.value, voice: voiceSelect.value };
  try {
    localStorage.setItem(VOICE_KEY, voiceSelect.value);
  } catch {
    // Storage blocked: the default voice will be offered next time.
  }
  saveButton.disabled = true;
  formMessage.textContent = 'Сохраняю…';
  const request = editingId
    ? api(`/api/admin/texts/${encodeURIComponent(editingId)}`, 'PATCH', body)
    : api('/api/admin/texts', 'POST', body);
  void request
    .then(async (answer) => {
      if (!answer.ok) {
        formMessage.textContent = problemOf(answer);
        await loadList();
        return;
      }
      // A new text always goes to processing; an edit only when its text or voice changed.
      const processing = !editingId || (answer.data as unknown as TextDoc).status === 'processing';
      formMessage.textContent = processing ? 'Готово. Обработка займёт 2–3 минуты, список обновится сам.' : 'Сохранено.';
      resetForm();
      await loadList();
    })
    .finally(() => {
      saveButton.disabled = false;
    });
});

cancelButton.addEventListener('click', () => {
  resetForm();
  formMessage.textContent = '';
});

element<HTMLButtonElement>('#logout').addEventListener('click', () => {
  void logout().finally(showLogin);
});

textInput.addEventListener('input', updateCounter);

for (const voice of VOICES) {
  const option = document.createElement('option');
  option.value = voiceKey(voice);
  option.textContent = `${voice.id} — ${voice.label}`;
  voiceSelect.append(option);
}

/** Decides what to show first: the invite password form, the panel, or the login form. */
async function main(): Promise<void> {
  const callback = await handleAuthCallback().catch(() => null);
  // The token is in the address; remove it so it is not left in the history or reused.
  if (callback) history.replaceState(null, '', location.pathname);
  if (callback?.type === 'invite' && callback.token) return showPasswordForm(callback.token);
  if (await getUser()) showPanel();
  else showLogin();
}

void main();
