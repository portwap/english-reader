// Home page: the list of ready texts with links to their pages.

import { fetchTexts, textPageUrl } from './api.ts';
import './style.css';

// Links from Netlify Identity emails (invite, password reset) open the site's home page; the admin page handles them.
if (/(invite|recovery|confirmation)_token=/.test(location.hash)) location.replace(`/admin${location.hash}`);

const list = document.querySelector<HTMLUListElement>('#texts');
const status = document.querySelector<HTMLParagraphElement>('#status');

/** Loads the texts and shows them as links, or a message if there are none or loading failed. */
async function showTexts(): Promise<void> {
  if (!list || !status) return;
  try {
    const texts = await fetchTexts();
    status.textContent = texts.length === 0 ? 'Текстов пока нет.' : '';
    for (const text of texts) {
      const link = document.createElement('a');
      link.href = textPageUrl(text.id);
      link.textContent = text.title;
      const item = document.createElement('li');
      item.append(link);
      list.append(item);
    }
  } catch {
    status.textContent = 'Не удалось загрузить список текстов. Обновите страницу.';
  }
}

void showTexts();
