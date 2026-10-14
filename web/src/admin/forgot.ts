// Admin password reset request: sends an email with a link to /admin/password.

import { requestPasswordRecovery } from '@netlify/identity';
import { busy, element } from './common.ts';

const form = element<HTMLFormElement>('#form');
const email = element<HTMLInputElement>('#email');
const submit = element<HTMLButtonElement>('#submit');
const message = element<HTMLParagraphElement>('#message');

form.addEventListener('submit', (event) => {
  event.preventDefault();
  void busy(submit, async () => {
    // The same answer for any address, so the page does not tell whether such a user exists.
    await requestPasswordRecovery(email.value.trim()).catch(() => undefined);
    message.textContent = 'Если такая почта есть, на неё пришло письмо со ссылкой. Проверьте и папку «Спам».';
  });
});
