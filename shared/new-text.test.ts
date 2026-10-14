// Tests for the rules of a new text and the document it starts as.

import { describe, expect, it } from 'vitest';
import { checkTextInput, ID_PATTERN, makeTextId, MAX_TEXT_LENGTH, newTextDoc, normalizeSource } from './new-text.ts';

const good = { title: 'Anna', text: 'Anna reads.', voice: 'kokoro:am_liam' };

describe('checkTextInput', () => {
  it('accepts a title, an English text and an allowed voice', () => {
    expect(checkTextInput(good)).toEqual([]);
  });

  it('reports every missing or wrong field', () => {
    expect(checkTextInput({ title: ' ', text: '', voice: 'kokoro:nobody' })).toEqual([
      'Введите название.',
      'Вставьте текст.',
      'Выберите голос из списка.',
    ]);
  });

  it('refuses fields of the wrong type, as a forged request might send', () => {
    expect(checkTextInput({ title: 42, text: ['x'], voice: null })).toHaveLength(3);
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
  it('starts a text as processing with the chosen voice and the normalized source', () => {
    const doc = newTextDoc({ ...good, title: ' Anna ', text: ' One.\r\nTwo. ' }, new Date('2026-10-14T09:00:00Z'));
    expect(doc).toMatchObject({
      title: 'Anna',
      status: 'processing',
      source: 'One.\nTwo.',
      createdAt: '2026-10-14T09:00:00.000Z',
      updatedAt: '2026-10-14T09:00:00.000Z',
      tts: { provider: 'kokoro', voice: 'am_liam' },
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
});
