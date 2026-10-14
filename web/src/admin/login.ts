// Admin login page: email and password; afterwards back to the admin page that was asked for.

import { AuthError, getUser, login } from '@netlify/identity';
import { busy, element, safeNext } from './common.ts';

const form = element<HTMLFormElement>('#form');
const email = element<HTMLInputElement>('#email');
const password = element<HTMLInputElement>('#password');
const submit = element<HTMLButtonElement>('#submit');
const message = element<HTMLParagraphElement>('#message');
const next = safeNext(new URLSearchParams(location.search).get('next'));

// Already logged in: nothing to do here.
void getUser().then((user) => {
  if (user) location.replace(next);
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  message.textContent = 'Вхожу…';
  void busy(submit, async () => {
    try {
      await login(email.value.trim(), password.value);
    } catch (error) {
      password.value = '';
      const status = error instanceof AuthError ? error.status : undefined;
      message.textContent =
        status !== undefined && status >= 400 && status < 500
          ? 'Неверная почта или пароль.'
          : 'Сервис входа не ответил. Попробуйте ещё раз через минуту.';
      return;
    }
    location.replace(next);
  });
});
