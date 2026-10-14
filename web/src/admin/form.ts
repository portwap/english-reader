// Admin form for a text: /admin/new adds one, /admin/texts/<id>/edit edits one. After saving, the text's page opens.

import { canChange, MAX_TEXT_LENGTH } from '../../../shared/new-text.ts';
import type { TextDoc } from '../../../shared/text-doc.ts';
import {
  DEFAULT_TRANSLATION_MODEL,
  findTranslationModel,
  TRANSLATION_MODELS,
  translationModelKey,
} from '../../../shared/translation-models.ts';
import { DEFAULT_VOICE, findVoice, VOICES, voiceKey } from '../../../shared/voices.ts';
import { adminTextUrl, api, busy, element, problemOf, requireLogin, setupMenu, showContent } from './common.ts';

const form = element<HTMLFormElement>('#content');
const heading = element<HTMLHeadingElement>('#heading');
const titleInput = element<HTMLInputElement>('#title');
const textInput = element<HTMLTextAreaElement>('#text');
const voiceSelect = element<HTMLSelectElement>('#voice');
const modelSelect = element<HTMLSelectElement>('#translation-model');
const counter = element<HTMLParagraphElement>('#counter');
const save = element<HTMLButtonElement>('#save');
const cancel = element<HTMLAnchorElement>('#cancel');
const message = element<HTMLParagraphElement>('#message');

/** Where this browser keeps the last chosen voice and model, so the next text gets them by default. */
const VOICE_KEY = 'admin-voice';
const MODEL_KEY = 'admin-translation-model';

/** Id of the edited text from /admin/texts/<id>/edit, or null on /admin/new. */
const editingId = decodeURIComponent(/^\/admin\/texts\/([^/]+)\/edit/.exec(location.pathname)?.[1] ?? '') || null;

/** Updates the character counter under the text field. */
function updateCounter(): void {
  const length = textInput.value.trim().length;
  counter.textContent = `${length} / ${MAX_TEXT_LENGTH}`;
  counter.classList.toggle('over', length > MAX_TEXT_LENGTH);
}

/**
 * Reads a remembered choice; browser storage may be unavailable, so the default is the fallback.
 * @param storageKey Where the choice is kept.
 * @param isAllowed Whether a stored value is still in the list.
 * @param fallback The default.
 * @returns The remembered value if still allowed, otherwise the default.
 */
function remembered(storageKey: string, isAllowed: (value: string) => boolean, fallback: string): string {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved && isAllowed(saved)) return saved;
  } catch {
    // Storage blocked: use the default.
  }
  return fallback;
}

/**
 * Remembers a choice for the next text; a blocked storage just means the default next time.
 * @param storageKey Where to keep it.
 * @param value The choice.
 */
function remember(storageKey: string, value: string): void {
  try {
    localStorage.setItem(storageKey, value);
  } catch {
    // Storage blocked: nothing to do.
  }
}

/**
 * Fills the form with the text being edited.
 * @param id Text id.
 * @returns False if the text could not be loaded or cannot be changed now.
 */
async function loadForEdit(id: string): Promise<boolean> {
  heading.textContent = 'Изменить текст';
  document.title = 'Изменить текст · English Reader';
  // The menu marks "Новый текст" on this page; editing is not that.
  document.querySelector('[aria-current="page"]')?.removeAttribute('aria-current');
  save.textContent = 'Сохранить';
  cancel.href = adminTextUrl(id);
  const answer = await api(`/api/admin/texts/${encodeURIComponent(id)}`);
  if (!answer.ok) {
    message.textContent = problemOf(answer);
    save.disabled = true;
    return false;
  }
  const doc = answer.data as unknown as TextDoc;
  titleInput.value = doc.title;
  textInput.value = doc.source;
  voiceSelect.value = voiceKey({ provider: doc.tts.provider, id: doc.tts.voice });
  // Texts saved before models could be chosen show the default one.
  const preferred = doc.translation.preferred;
  modelSelect.value = preferred ? translationModelKey({ provider: doc.translation.provider, id: preferred }) : DEFAULT_TRANSLATION_MODEL;
  if (!canChange(doc)) {
    message.textContent = 'Текст сейчас обрабатывается. Изменить его можно будет, когда обработка закончится.';
    save.disabled = true;
    return false;
  }
  message.textContent = 'Новое название сохранится сразу; при новом тексте, голосе или модели перевода текст обработается заново.';
  return true;
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const body = {
    title: titleInput.value,
    text: textInput.value,
    voice: voiceSelect.value,
    translationModel: modelSelect.value,
  };
  remember(VOICE_KEY, voiceSelect.value);
  remember(MODEL_KEY, modelSelect.value);
  message.textContent = 'Сохраняю…';
  void busy(save, async () => {
    const answer = editingId
      ? await api(`/api/admin/texts/${encodeURIComponent(editingId)}`, 'PATCH', body)
      : await api('/api/admin/texts', 'POST', body);
    // 502: the text was saved but its processing did not start; its page shows the reason and a retry button.
    const savedId = editingId ?? (answer.data.id as string | undefined);
    if ((answer.ok || answer.status === 502) && savedId) {
      location.assign(adminTextUrl(savedId));
      return;
    }
    if (answer.status !== 401) message.textContent = problemOf(answer);
  });
});

textInput.addEventListener('input', updateCounter);

for (const voice of VOICES) {
  const option = document.createElement('option');
  option.value = voiceKey(voice);
  option.textContent = `${voice.id} — ${voice.label}`;
  voiceSelect.append(option);
}
for (const model of TRANSLATION_MODELS) {
  const option = document.createElement('option');
  option.value = translationModelKey(model);
  option.textContent = model.label;
  modelSelect.append(option);
}

/** Checks the login, fills the form when editing, then shows it. */
async function start(): Promise<void> {
  await requireLogin();
  setupMenu();
  voiceSelect.value = remembered(VOICE_KEY, (value) => Boolean(findVoice(value)), DEFAULT_VOICE);
  modelSelect.value = remembered(MODEL_KEY, (value) => Boolean(findTranslationModel(value)), DEFAULT_TRANSLATION_MODEL);
  if (editingId) await loadForEdit(editingId);
  updateCounter();
  showContent(form);
  titleInput.focus();
}

void start();
