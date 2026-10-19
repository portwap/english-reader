// Tests for the rules of a new text and the document it starts as.

import { describe, expect, it } from 'vitest';
import {
  canChange,
  checkTextInput,
  dropEmptyLines,
  ID_PATTERN,
  makeTextId,
  MAX_TEXT_LENGTH,
  newTextDoc,
  normalizeSource,
} from './new-text.ts';

const good = {
  title: 'Anna',
  text: 'Anna reads.',
  voice: 'kokoro:am_liam',
  translationModel: 'openrouter:google/gemma-4-31b-it:free',
};

describe('checkTextInput', () => {
  it('accepts a title, an English text and an allowed voice', () => {
    expect(checkTextInput(good)).toEqual([]);
  });

  it('reports every missing or wrong field', () => {
    expect(checkTextInput({ title: ' ', text: '', voice: 'kokoro:nobody', translationModel: 'x' })).toEqual([
      'Введите название.',
      'Вставьте текст.',
      'Выберите голос из списка.',
      'Выберите модель перевода из списка.',
    ]);
  });

  it('refuses fields of the wrong type, as a forged request might send', () => {
    expect(checkTextInput({ title: 42, text: ['x'], voice: null, translationModel: 7 })).toHaveLength(4);
  });

  it('refuses a text longer than the limit, counted after trimming', () => {
    expect(checkTextInput({ ...good, text: `  ${'a'.repeat(MAX_TEXT_LENGTH)}  ` })).toEqual([]);
    expect(checkTextInput({ ...good, text: 'a'.repeat(MAX_TEXT_LENGTH + 1) })[0]).toMatch(/длиннее 5000/);
  });

  it('refuses a text with no English letters', () => {
    expect(checkTextInput({ ...good, text: 'Привет, мир.' })).toEqual(['В тексте нет английских слов.']);
  });
});

describe('makeTextId', () => {
  it('makes a short readable slug with a random ending that fits the id pattern', () => {
    expect(makeTextId('A Walk in the Park!')).toMatch(/^a-walk-in-the-park-[0-9a-f]{6}$/);
    expect(makeTextId('Привет')).toMatch(/^text-[0-9a-f]{6}$/);
    expect(ID_PATTERN.test(makeTextId('x'.repeat(300)))).toBe(true);
  });
});

describe('ID_PATTERN', () => {
  it('refuses ids that could reach outside the expected keys', () => {
    for (const bad of ['', '../x', 'a/b', 'A', 'a b', 'x'.repeat(65)]) expect(ID_PATTERN.test(bad)).toBe(false);
  });
});

describe('newTextDoc', () => {
  it('starts a text as processing with the chosen voice, translation model and the normalized source', () => {
    const doc = newTextDoc({ ...good, title: ' Anna ', text: ' One.\r\nTwo. ' }, new Date('2026-10-14T09:00:00Z'));
    expect(doc).toMatchObject({
      title: 'Anna',
      status: 'processing',
      source: 'One.\nTwo.',
      createdAt: '2026-10-14T09:00:00.000Z',
      updatedAt: '2026-10-14T09:00:00.000Z',
      tts: { provider: 'kokoro', voice: 'am_liam' },
      translation: { provider: 'openrouter', model: '', preferred: 'google/gemma-4-31b-it:free' },
      audio: '',
      sentences: [],
    });
    expect(doc.id).toMatch(/^anna-[0-9a-f]{6}$/);
  });
});

describe('normalizeSource', () => {
  it('turns Windows and old Mac line endings into \\n and trims the text', () => {
    expect(normalizeSource('  One.\r\nTwo.\rThree.  \n')).toBe('One.\nTwo.\nThree.');
  });

  it('drops empty lines between paragraphs, also lines of spaces, and keeps one line per paragraph', () => {
    expect(normalizeSource('\n\nOne. Two.\n\n\nThree.\r\n  \r\nFour.\n')).toBe('One. Two.\nThree.\nFour.');
    expect(dropEmptyLines('One.\n\nTwo.\n')).toBe('One.\nTwo.\n');
  });
});

describe('canChange', () => {
  const now = new Date('2026-10-14T10:00:00Z');

  it('allows changes to ready texts and texts with an error', () => {
    expect(canChange({ status: 'ready', createdAt: '2026-10-14T09:59:00Z' }, now)).toBe(true);
    expect(canChange({ status: 'error', createdAt: '2026-10-14T09:59:00Z' }, now)).toBe(true);
  });

  it('holds changes while a run is working on the text', () => {
    expect(canChange({ status: 'processing', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-14T09:50:00Z' }, now)).toBe(false);
  });

  it('allows changes once a processing text is stuck for more than 25 minutes', () => {
    expect(canChange({ status: 'processing', createdAt: '2026-10-14T09:38:00Z' }, now)).toBe(false);
    expect(canChange({ status: 'processing', createdAt: '2026-10-14T09:30:00Z' }, now)).toBe(true);
  });
});
