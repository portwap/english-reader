// Home page: the newest ready texts with links to their pages, ten at a time with "Показать ещё".

import { showAdminBar } from './admin-bar.ts';
import { fetchTexts, textPageUrl } from './api.ts';
import './style.css';

// Links from Netlify Identity emails (invite, password reset) open the site's home page; the password page handles them.
if (/(invite|recovery|confirmation)_token=/.test(location.hash)) location.replace(`/admin/password${location.hash}`);

/** How many texts each "Показать ещё" adds. */
const PAGE_SIZE = 10;

const list = document.querySelector<HTMLUListElement>('#texts');
const status = document.querySelector<HTMLParagraphElement>('#status');
const more = document.querySelector<HTMLButtonElement>('#more');

/** Loads the next page of texts and adds it to the list; hides "Показать ещё" when all are shown. */
async function showMore(): Promise<void> {
  if (!list || !status || !more) return;
  more.disabled = true;
  try {
    const page = await fetchTexts(list.children.length, PAGE_SIZE);
    for (const text of page.texts) {
      const link = document.createElement('a');
      link.href = textPageUrl(text.id);
      link.textContent = text.title;
      const item = document.createElement('li');
      item.append(link);
      list.append(item);
    }
    status.textContent = page.total === 0 ? 'Текстов пока нет.' : '';
    more.hidden = list.children.length >= page.total;
  } catch {
    status.textContent = 'Не удалось загрузить список текстов. Обновите страницу.';
  } finally {
    more.disabled = false;
  }
}

showAdminBar([
  { label: 'Админка', href: '/admin/' },
  { label: 'Новый текст', href: '/admin/new' },
]);
more?.addEventListener('click', () => void showMore());
void showMore();
