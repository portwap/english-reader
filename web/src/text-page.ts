// Text page: one sentence per line, with word highlight while reading. Tapping a sentence selects it;
// the bottom bar plays the whole text or the selected sentence, and shows the selected sentence's translation.

import type { DocWord, TextDoc } from '../../shared/text-doc.ts';
import { audioUrl, fetchText } from './api.ts';
import { Player } from './player.ts';
import { lastWordStarted, sentenceParts, sentenceRange, wordIndexAt } from './timeline.ts';
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
const hintBox = element<HTMLParagraphElement>('#hint');

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
 * Scrolls a word into view if it is hidden above the screen or behind the bottom bar.
 * @param word The word's element.
 */
function keepInView(word: HTMLElement): void {
  const box = word.getBoundingClientRect();
  const visibleBottom = window.innerHeight - bar.getBoundingClientRect().height;
  if (box.top < 0 || box.bottom > visibleBottom) word.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

/**
 * Builds the page for a ready text and connects the controls. The text is usable at once;
 * the play buttons wait until the audio is loaded (see main).
 * @param doc The text.
 * @param player The player that will hold the text's audio.
 * @returns A function that turns on the play buttons; call it once the audio is loaded.
 */
function showText(doc: TextDoc, player: Player): () => void {
  const words: DocWord[] = doc.sentences.flatMap((sentence) => sentence.words);
  const wordSpans: HTMLSpanElement[] = [];
  const sentenceLines: HTMLElement[] = [];

  // Each sentence is its own line; a paragraph is a group of lines with a gap after it.
  let paragraph: HTMLDivElement | null = null;
  let paragraphNumber = -1;
  for (const [s, sentence] of doc.sentences.entries()) {
    if (sentence.paragraph !== paragraphNumber || !paragraph) {
      paragraph = document.createElement('div');
      paragraph.className = 'paragraph';
      textBox.append(paragraph);
      paragraphNumber = sentence.paragraph;
    }
    const line = document.createElement('p');
    line.className = 'sentence';
    line.dataset.index = String(s);
    for (const part of sentenceParts(sentence)) {
      if (!part.word) {
        line.append(part.text);
        continue;
      }
      const wordSpan = document.createElement('span');
      wordSpan.textContent = part.text;
      wordSpans.push(wordSpan);
      line.append(wordSpan);
    }
    sentenceLines.push(line);
    paragraph.append(line);
  }

  let litWord = -1;
  let pausedWord = -1;
  let selected = -1;
  let showTranslation = false;
  /** What is playing: the whole text, the selected sentence, or nothing. */
  let mode: 'idle' | 'all' | 'sentence' = 'idle';
  /** Where reading the whole text continues after a pause. */
  let resumeAt = 0;
  let soundReady = false;

  /** Tells the reader what they can do next: select a sentence, or play or translate the selected one. */
  function updateHint(): void {
    if (!soundReady) return;
    hintBox.textContent =
      selected < 0
        ? 'Нажмите на предложение, чтобы выбрать его.'
        : 'Предложение выбрано: его можно послушать или открыть перевод.';
  }

  /** Moves the reading highlight to a word, or removes it for -1. */
  function light(index: number): void {
    if (index === litWord) return;
    wordSpans[litWord]?.classList.remove('now');
    const span = wordSpans[index];
    span?.classList.add('now');
    if (span && mode === 'all') keepInView(span);
    litWord = index;
  }

  /** Marks the word where reading the whole text was paused, or removes the mark for -1. */
  function markPause(index: number): void {
    wordSpans[pausedWord]?.classList.remove('paused');
    wordSpans[index]?.classList.add('paused');
    pausedWord = index;
  }

  /** Selects a sentence, or clears the selection for -1, and updates the bar to match. */
  function select(index: number): void {
    sentenceLines[selected]?.classList.remove('selected');
    selected = index;
    sentenceLines[index]?.classList.add('selected');
    playSentenceButton.disabled = index < 0 || player.duration === 0;
    translateButton.disabled = index < 0;
    updateTranslation();
    updateHint();
  }

  /** Shows the translation of the selected sentence when it is turned on. */
  function updateTranslation(): void {
    const sentence = doc.sentences[selected];
    translationBox.hidden = !showTranslation || !sentence;
    translationBox.textContent = sentence?.translation ?? '';
    translateButton.setAttribute('aria-pressed', String(showTranslation));
  }

  player.onTick = (position) => light(wordIndexAt(words, position));
  player.onStop = (position) => {
    if (mode === 'all') {
      // At the very end, the next reading starts again from the beginning.
      const finished = position >= player.duration - 0.05;
      resumeAt = finished ? 0 : position;
      markPause(finished ? -1 : lastWordStarted(words, position));
    }
    mode = 'idle';
    light(-1);
    playAllButton.textContent = resumeAt > 0 ? '▶ Дальше' : '▶ Текст';
  };

  playAllButton.addEventListener('click', () => {
    if (mode === 'all') {
      player.stop();
      return;
    }
    player.stop();
    select(-1);
    markPause(-1);
    mode = 'all';
    player.play(resumeAt);
    playAllButton.textContent = '⏸ Пауза';
  });

  playSentenceButton.addEventListener('click', () => {
    if (selected < 0) return;
    player.stop();
    const range = sentenceRange(doc.sentences, selected, player.duration);
    mode = 'sentence';
    player.play(range.from, range.to);
  });

  translateButton.addEventListener('click', () => {
    showTranslation = !showTranslation;
    updateTranslation();
  });

  textBox.addEventListener('click', (event) => {
    const line = (event.target as HTMLElement).closest<HTMLElement>('.sentence');
    if (!line) return;
    // Tapping the text stops any playback, so the selection and the sound never disagree.
    player.stop();
    select(Number(line.dataset.index));
  });

  return () => {
    soundReady = true;
    playAllButton.disabled = false;
    playSentenceButton.disabled = selected < 0;
    updateHint();
  };
}

/** Loads the text, shows it at once, then loads its audio. */
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

  statusBox.hidden = true;
  const player = new Player();
  const enableSound = showText(doc, player);
  bar.hidden = false;
  try {
    await player.load(audioUrl(doc.id));
  } catch {
    hintBox.textContent = 'Не удалось загрузить звук. Обновите страницу.';
    return;
  }
  enableSound();
}

void main();
