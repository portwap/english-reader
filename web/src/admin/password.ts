// Admin password page: sets the password from an invite link or a reset link, or changes it when logged in.

import { acceptInvite, AuthError, getUser, handleAuthCallback, login, updateUser } from '@netlify/identity';
import { busy, element, goToLogin, LEAVING, showContent } from './common.ts';

const form = element<HTMLFormElement>('#content');
const heading = element<HTMLHeadingElement>('#heading');
const newPassword = element<HTMLInputElement>('#new-password');
const newPasswordAgain = element<HTMLInputElement>('#new-password-again');
const submit = element<HTMLButtonElement>('#submit');
const message = element<HTMLParagraphElement>('#message');

/** Shortest password accepted; long passwords matter because there is no second login factor. */
const MIN_PASSWORD_LENGTH = 12;

/** What the new password is for: an invite (needs its token), or a reset or change (already logged in). */
type Mode = { kind: 'invite'; token: string } | { kind: 'logged-in' };

/**
 * Saves the new password.
 * @param mode What the password is for.
 * @param password The new password, already checked.
 */
async function save(mode: Mode, password: string): Promise<void> {
  if (mode.kind === 'logged-in') {
    await updateUser({ password });
    return;
  }
  const user = await acceptInvite(mode.token, password);
  // Accepting an invite starts a session only in the browser; a normal login also gives the server its cookie.
  if (user.email) await login(user.email, password);
}

/**
 * Connects the form for one mode.
 * @param mode What the new password is for.
 */
function setup(mode: Mode): void {
  heading.textContent = mode.kind === 'invite' ? 'Задайте пароль' : 'Новый пароль';
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const password = newPassword.value;
    if (password.length < MIN_PASSWORD_LENGTH) {
      message.textContent = `Пароль должен быть не короче ${MIN_PASSWORD_LENGTH} символов.`;
      return;
    }
    if (password !== newPasswordAgain.value) {
      message.textContent = 'Пароли не совпадают.';
      return;
    }
    message.textContent = 'Сохраняю…';
    void busy(submit, async () => {
      try {
        await save(mode, password);
      } catch (error) {
        const status = error instanceof AuthError ? error.status : undefined;
        message.textContent =
          status !== undefined && status >= 400 && status < 500
            ? mode.kind === 'invite'
              ? 'Приглашение устарело или уже использовано. Попросите новое в Netlify.'
              : 'Не получилось сохранить пароль. Войдите заново и попробуйте ещё раз.'
            : 'Сервис входа не ответил. Попробуйте ещё раз через минуту.';
        return;
      }
      location.replace('/admin/');
      return LEAVING;
    });
  });
  showContent(form);
}

/** Reads the link from the email, if any, and shows the form; without a link only a logged-in admin may change the password. */
async function start(): Promise<void> {
  let callback = null;
  try {
    callback = await handleAuthCallback();
  } catch {
    location.replace('/admin/login');
    return;
  }
  if (callback?.type === 'invite' && callback.token) return setup({ kind: 'invite', token: callback.token });
  // A reset link logs the admin in, so it is the same as changing the password while logged in.
  if (callback?.type === 'recovery' || (await getUser())) return setup({ kind: 'logged-in' });
  goToLogin();
}

void start();
