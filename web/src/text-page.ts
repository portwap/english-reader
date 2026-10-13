// Text page: the text with word highlight, and a bottom bar to play the whole text, a sentence,
// or a word, and to show a sentence's translation.

import type { DocWord, TextDoc } from '../../shared/text-doc.ts';
import { audioUrl, fetchText } from './api.ts';
import { Player } from './player.ts';
import { sentenceParts, wordIndexAt, wordRange } from './timeline.ts';
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

const titleBox = element<HTMLHeadingElement>('#title');
const textBox = element<HTMLElement>('#text');
const statusBox = element<HTMLParagraphElement>('#status');
const bar = element<HTMLElement>('#bar');
const playAllButton = element<HTMLButtonElement>('#play-all');
const playSentenceButton = element<HTMLButtonElement>('#play-sentence');
const translateButton = element<HTMLButtonElement>('#translate');
const translationBox = element<HTMLParagraphElement>('#translation');

/**
 * Reads the text id from the address: /texts/<id>, or ?id=<id> when pages are served without redirects.
 * @returns The id, or an empty string.
 */
function textIdFromUrl(): string {
  const match = /^\/texts\/([^/]+)/.exec(location.pathname);
  return decodeURIComponent(match?.[1] ?? new URLSearchParams(location.search).get('id') ?? '');
}

/**
 * Shows a message instead of the text.
 * @param message What to say.
 */
function showStatus(message: string): void {
  statusBox.textContent = message;
  statusBox.hidden = false;
}

/**
 * Builds the page for a ready text and connects the controls.
 * @param doc The text.
 * @param player A player with the text's audio loaded.
 */
function showText(doc: TextDoc, player: Player): void {
  const words: DocWord[] = doc.sentences.flatMap((sentence) => sentence.words);
  const wordSpans: HTMLSpanElement[] = [];
  const sentenceSpans: HTMLSpanElement[] = [];
  const sentenceOfWord: number[] = [];

  // Sentences flow inside paragraphs, like in a book; each word is its own tappable span.
  let paragraph: HTMLParagraphElement | null = null;
  let paragraphNumber = -1;
  for (const [s, sentence] of doc.sentences.entries()) {
    if (sentence.paragraph !== paragraphNumber || !paragraph) {
      paragraph = document.createElement('p');
      textBox.append(paragraph);
      paragraphNumber = sentence.paragraph;
    } else {
      paragraph.append(' ');
    }
    const sentenceSpan = document.createElement('span');
    sentenceSpan.className = 'sentence';
    for (const part of sentenceParts(sentence)) {
      if (!part.word) {
        sentenceSpan.append(part.text);
        continue;
      }
      const wordSpan = document.createElement('span');
      wordSpan.className = 'word';
      wordSpan.textContent = part.text;
      wordSpan.dataset.index = String(wordSpans.length);
      wordSpans.push(wordSpan);
      sentenceOfWord.push(s);
      sentenceSpan.append(wordSpan);
    }
    sentenceSpans.push(sentenceSpan);
    paragraph.append(sentenceSpan);
  }

  let litWord = -1;
  let selected = -1;
  let showTranslation = false;
  /** Where "play all" continues after a pause; separate from word and sentence playback. */
  let resumeAt = 0;
  let playingAll = false;

  /** Moves the word highlight to the given word, or removes it for -1. */
  function light(index: number): void {
    if (index === litWord) return;
    wordSpans[litWord]?.classList.remove('now');
    wordSpans[index]?.classList.add('now');
    litWord = index;
  }

  /** Marks a sentence as selected and shows its controls and, if asked, its translation. */
  function select(s: number): void {
    sentenceSpans[selected]?.classList.remove('selected');
    selected = s;
    sentenceSpans[s]?.classList.add('selected');
    playSentenceButton.disabled = false;
    translateButton.disabled = false;
    updateTranslation();
  }

  /** Shows or hides the translation of the selected sentence. */
  function updateTranslation(): void {
    const sentence = doc.sentences[selected];
    translationBox.hidden = !showTranslation || !sentence;
    translationBox.textContent = sentence?.translation ?? '';
    translateButton.textContent = showTranslation ? 'Скрыть перевод' : 'Перевод';
  }

  player.onTick = (position) => light(wordIndexAt(words, position));
  player.onStop = (position) => {
    light(-1);
    if (playingAll) {
      // At the very end, the next "play all" starts again from the beginning.
      resumeAt = position >= player.duration - 0.05 ? 0 : position;
      playingAll = false;
    }
    playAllButton.textContent = resumeAt > 0 ? '▶ Дальше' : '▶ Весь текст';
  };

  playAllButton.addEventListener('click', () => {
    if (playingAll) {
      player.stop();
      return;
    }
    player.stop();
    playingAll = true;
    player.play(resumeAt);
    playAllButton.textContent = '⏸ Пауза';
  });

  playSentenceButton.addEventListener('click', () => {
    const sentence = doc.sentences[selected];
    if (!sentence) return;
    player.stop();
    player.play(sentence.start, sentence.end);
  });

  translateButton.addEventListener('click', () => {
    showTranslation = !showTranslation;
    updateTranslation();
  });

  textBox.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLSpanElement>('.word');
    const index = Number(target?.dataset.index);
    const word = words[index];
    if (!target || !word) return;
    select(sentenceOfWord[index] ?? -1);
    player.stop();
    const range = wordRange(word, player.duration);
    player.play(range.from, range.to);
  });

  bar.hidden = false;
}

/** Loads the text and its audio, then shows the page or a clear message. */
async function main(): Promise<void> {
  const id = textIdFromUrl();
  if (!id) return showStatus('Не указан текст.');
  let doc: TextDoc;
  try {
    doc = await fetchText(id);
  } catch (error) {
    return showStatus(
      error instanceof Error && error.message === 'not-found'
        ? 'Такого текста нет.'
        : 'Не удалось загрузить текст. Обновите страницу.',
    );
  }
  document.title = doc.title;
  titleBox.textContent = doc.title;
  if (doc.status === 'processing') return showStatus('Текст ещё обрабатывается. Обновите страницу через пару минут.');
  if (doc.status === 'error') return showStatus(`Текст не удалось обработать: ${doc.error ?? 'неизвестная ошибка'}`);

  showStatus('Загружаю звук…');
  const player = new Player();
  try {
    await player.load(audioUrl(doc.id));
  } catch {
    return showStatus('Не удалось загрузить звук. Обновите страницу.');
  }
  statusBox.hidden = true;
  showText(doc, player);
}

void main();
