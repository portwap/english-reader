// Admin page: login through Netlify Identity, setting a password, adding, editing, retrying and deleting texts.
// Exactly one view is visible at a time, switched only by show(). The panel opens only after the server
// has confirmed the login, and every action is checked again on the server by the admin API.

import {
  acceptInvite,
  AuthError,
  getUser,
  handleAuthCallback,
  login,
  logout,
  requestPasswordRecovery,
  updateUser,
} from '@netlify/identity';
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

const views = {
  loading: element<HTMLParagraphElement>('#view-loading'),
  password: element<HTMLFormElement>('#view-password'),
  login: element<HTMLFormElement>('#view-login'),
  panel: element<HTMLElement>('#view-panel'),
};
type View = keyof typeof views;

const passwordHeading = element<HTMLHeadingElement>('#password-heading');
const newPassword = element<HTMLInputElement>('#new-password');
const newPasswordAgain = element<HTMLInputElement>('#new-password-again');
const passwordSave = element<HTMLButtonElement>('#password-save');
const passwordMessage = element<HTMLParagraphElement>('#password-message');
const emailInput = element<HTMLInputElement>('#email');
const passwordInput = element<HTMLInputElement>('#password');
const loginSubmit = element<HTMLButtonElement>('#login-submit');
const forgotButton = element<HTMLButtonElement>('#forgot');
const loginMessage = element<HTMLParagraphElement>('#login-message');
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
const VOICE_STORAGE_KEY = 'admin-voice';
/** Shortest password accepted; long passwords matter because there is no second login factor. */
const MIN_PASSWORD_LENGTH = 12;

/** Id of the text being edited, or null when the form adds a new text. */
let editingId: string | null = null;
let refreshTimer = 0;
/** What the password view is for: accepting an invite (needs its token) or setting a new password after a reset. */
let passwordMode: { kind: 'invite'; token: string } | { kind: 'reset' } = { kind: 'reset' };

/**
 * Shows exactly one view and hides the others.
 * @param view The view to show.
 */
function show(view: View): void {
  for (const [name, box] of Object.entries(views)) box.hidden = name !== view;
  if (view !== 'panel') window.clearTimeout(refreshTimer);
}

/**
 * Runs an action with its button turned off, so a double tap cannot send it twice.
 * @param button The button that started the action.
 * @param action The action.
 */
async function busy(button: HTMLButtonElement, action: () => Promise<void>): Promise<void> {
  button.disabled = true;
  try {
    await action();
  } finally {
    button.disabled = false;
  }
}

/** Answer of the admin API: whether it succeeded, its status and its JSON body. */
interface ApiAnswer {
  ok: boolean;
  status: number;
  data: { error?: string; errors?: string[] } & Record<string, unknown>;
}

/**
 * Calls the admin API. A "not logged in" answer brings back the login view.
 * @param path API path.
 * @param method HTTP method.
 * @param body JSON body for POST and PATCH.
 * @returns The answer; a network failure is reported as status 0.
 */
async function api(path: string, method = 'GET', body?: unknown): Promise<ApiAnswer> {
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
  if (response.status === 401) showLogin('Сессия закончилась. Войдите снова.');
  return { ok: response.ok, status: response.status, data };
}

/**
 * Describes what went wrong in an API answer.
 * @param answer A failed answer.
 * @returns A message in Russian.
 */
function problemOf(answer: ApiAnswer): string {
  if (answer.data.errors?.length) return answer.data.errors.join(' ');
  return answer.data.error ?? `Ошибка сервера (${answer.status}). Попробуйте ещё раз.`;
}

/**
 * Describes a login service error.
 * @param error What the login library threw.
 * @param wrongCredentials Message for a rejected email or password.
 * @returns A message in Russian.
 */
function authProblem(error: unknown, wrongCredentials: string): string {
  const status = error instanceof AuthError ? error.status : undefined;
  if (status !== undefined && status >= 400 && status < 500) return wrongCredentials;
  return `Сервис входа не ответил${status ? ` (${status})` : ''}. Попробуйте ещё раз через минуту.`;
}

// ---------- Login, passwords, logout ----------

/**
 * Shows the login view.
 * @param message Optional explanation, for example why the login is needed again.
 */
function showLogin(message = ''): void {
  passwordInput.value = '';
  loginMessage.textContent = message;
  show('login');
}

/**
 * Shows the password view for an invite or after a reset email.
 * @param mode What the new password is for.
 */
function showPasswordView(mode: typeof passwordMode): void {
  passwordMode = mode;
  passwordHeading.textContent = mode.kind === 'invite' ? 'Задайте пароль' : 'Новый пароль';
  newPassword.value = '';
  newPasswordAgain.value = '';
  passwordMessage.textContent = '';
  show('password');
}

views.password.addEventListener('submit', (event) => {
  event.preventDefault();
  const password = newPassword.value;
  if (password.length < MIN_PASSWORD_LENGTH) {
    passwordMessage.textContent = `Пароль должен быть не короче ${MIN_PASSWORD_LENGTH} символов.`;
    return;
  }
  if (password !== newPasswordAgain.value) {
    passwordMessage.textContent = 'Пароли не совпадают.';
    return;
  }
  passwordMessage.textContent = 'Сохраняю…';
  void busy(passwordSave, async () => {
    try {
      if (passwordMode.kind === 'invite') {
        const user = await acceptInvite(passwordMode.token, password);
        if (!user.email) {
          showLogin('Пароль сохранён. Войдите с ним.');
          return;
        }
        // Accepting an invite starts a session only in the browser; a normal login also gives the server its cookie.
        await login(user.email, password);
      } else {
        await updateUser({ password });
      }
    } catch (error) {
      passwordMessage.textContent = authProblem(
        error,
        passwordMode.kind === 'invite'
          ? 'Приглашение устарело или уже использовано. Попросите новое в Netlify.'
          : 'Ссылка для сброса устарела. Нажмите «Забыли пароль?» ещё раз.',
      );
      return;
    }
    await openPanel();
  });
});

views.login.addEventListener('submit', (event) => {
  event.preventDefault();
  loginMessage.textContent = 'Вхожу…';
  void busy(loginSubmit, async () => {
    try {
      await login(emailInput.value.trim(), passwordInput.value);
    } catch (error) {
      passwordInput.value = '';
      loginMessage.textContent = authProblem(error, 'Неверная почта или пароль.');
      return;
    }
    loginMessage.textContent = '';
    await openPanel();
  });
});

forgotButton.addEventListener('click', () => {
  const email = emailInput.value.trim();
  if (!email || !emailInput.checkValidity()) {
    loginMessage.textContent = 'Впишите почту выше, и я отправлю на неё ссылку для нового пароля.';
    return;
  }
  void busy(forgotButton, async () => {
    // The same answer for any address, so the page does not tell whether such a user exists.
    await requestPasswordRecovery(email).catch(() => undefined);
    loginMessage.textContent = 'Если такая почта есть, на неё пришло письмо со ссылкой. Проверьте и «Спам».';
  });
});

element<HTMLButtonElement>('#logout').addEventListener('click', () => {
  void logout()
    .catch(() => undefined)
    .finally(() => {
      resetForm();
      list.replaceChildren();
      showLogin('Вы вышли.');
    });
});

// ---------- Panel: form and list ----------

/** Updates the character counter under the text field. */
function updateCounter(): void {
  const length = textInput.value.trim().length;
  counter.textContent = `${length} / ${MAX_TEXT_LENGTH}`;
  counter.classList.toggle('over', length > MAX_TEXT_LENGTH);
}

/**
 * Reads the last chosen voice; browser storage may be unavailable, so the default is the fallback.
 * @returns A voice key from the list.
 */
function savedVoice(): string {
  try {
    const saved = localStorage.getItem(VOICE_STORAGE_KEY);
    if (saved && findVoice(saved)) return saved;
  } catch {
    // Storage blocked: use the default.
  }
  return DEFAULT_VOICE;
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
 * Makes a small button for a list item; it is turned off while its action runs.
 * @param label Button text.
 * @param action What the button does.
 * @returns The button.
 */
function smallButton(label: string, action: () => Promise<void>): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', () => void busy(button, action));
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
      buttons.append(smallButton('Изменить', () => startEdit(text.id)));
      if (text.status !== 'ready') buttons.append(smallButton('Повторить', () => retry(text.id)));
      buttons.append(smallButton('Удалить', () => remove(text)));
    }
    item.append(title, details, buttons);
    list.append(item);
  }

  window.clearTimeout(refreshTimer);
  if (texts.some((text) => !canChange(text))) refreshTimer = window.setTimeout(() => void loadList(), 10_000);
}

/**
 * Loads and shows the list of texts.
 * @returns True if the list loaded.
 */
async function loadList(): Promise<boolean> {
  const answer = await api('/api/admin/texts');
  if (answer.ok) renderList(answer.data as unknown as TextSummary[]);
  else if (answer.status !== 401) formMessage.textContent = problemOf(answer);
  return answer.ok;
}

/**
 * Opens the panel once the server confirms the login by returning the list; until then the loading view stays.
 * If the server does not confirm it, api() has already switched to the login view.
 */
async function openPanel(): Promise<void> {
  show('loading');
  // The form keeps what was typed: after a session ends and the admin logs in again, nothing is lost.
  formMessage.textContent = '';
  const answer = await api('/api/admin/texts');
  if (answer.status === 401) {
    loginMessage.textContent = 'Сервер не подтвердил вход. Попробуйте войти ещё раз.';
    return;
  }
  show('panel');
  if (answer.ok) renderList(answer.data as unknown as TextSummary[]);
  else formMessage.textContent = problemOf(answer);
}

/**
 * Fills the form with a text, to edit it.
 * @param id Text id.
 */
async function startEdit(id: string): Promise<void> {
  const answer = await api(`/api/admin/texts/${encodeURIComponent(id)}`);
  if (!answer.ok) {
    if (answer.status !== 401) formMessage.textContent = problemOf(answer);
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
  if (answer.status === 401) return;
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
  if (answer.status === 401) return;
  formMessage.textContent = answer.ok ? `«${text.title}» удалён.` : problemOf(answer);
  if (answer.ok && editingId === text.id) resetForm();
  await loadList();
}

textForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const body = { title: titleInput.value, text: textInput.value, voice: voiceSelect.value };
  try {
    localStorage.setItem(VOICE_STORAGE_KEY, voiceSelect.value);
  } catch {
    // Storage blocked: the default voice will be offered next time.
  }
  formMessage.textContent = 'Сохраняю…';
  void busy(saveButton, async () => {
    const wasEditing = editingId !== null;
    const answer = wasEditing
      ? await api(`/api/admin/texts/${encodeURIComponent(editingId ?? '')}`, 'PATCH', body)
      : await api('/api/admin/texts', 'POST', body);
    if (answer.status === 401) return;
    if (!answer.ok) {
      formMessage.textContent = problemOf(answer);
      await loadList();
      return;
    }
    // A new text always goes to processing; an edit only when its text or voice changed.
    const processing = !wasEditing || (answer.data as unknown as TextDoc).status === 'processing';
    resetForm();
    formMessage.textContent = processing ? 'Готово. Обработка займёт 2–3 минуты, список обновится сам.' : 'Сохранено.';
    await loadList();
  });
});

cancelButton.addEventListener('click', () => {
  resetForm();
  formMessage.textContent = '';
});

textInput.addEventListener('input', updateCounter);

for (const voice of VOICES) {
  const option = document.createElement('option');
  option.value = voiceKey(voice);
  option.textContent = `${voice.id} — ${voice.label}`;
  voiceSelect.append(option);
}
resetForm();

// ---------- Start ----------

/** Decides the first view: a password form for an invite or reset link, the panel, or the login form. */
async function start(): Promise<void> {
  show('loading');
  let callback = null;
  try {
    callback = await handleAuthCallback();
  } catch {
    showLogin('Ссылка из письма устарела или уже использована.');
    return;
  }
  if (callback?.type === 'invite' && callback.token) return showPasswordView({ kind: 'invite', token: callback.token });
  if (callback?.type === 'recovery') return showPasswordView({ kind: 'reset' });
  if (await getUser()) await openPanel();
  else showLogin();
}

void start();
