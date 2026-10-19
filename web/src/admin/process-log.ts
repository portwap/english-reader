// Turns the processing log of a text into short Russian lines for the admin page.
// Kept apart from the page code, so the wording can be tested without a browser.

import type { AfterFailure, FailureReason, PartOf, ProcessEvent } from '../../../shared/text-doc.ts';
import { translationModelLabel } from '../../../shared/translation-models.ts';

/** One line of the log as the admin page shows it. */
export interface LogLine {
  /** Local time, for example "20:43:52". */
  time: string;
  text: string;
  /** Technical detail in English, shown smaller; empty if there is none. */
  detail: string;
}

/**
 * Formats a duration for people.
 * @param seconds Duration in seconds.
 * @returns For example "8,4 с", "62 с" or "4 мин 35 с".
 */
export function formatDuration(seconds: number): string {
  if (seconds < 10) return `${(Math.round(seconds * 10) / 10).toLocaleString('ru-RU')} с`;
  const whole = Math.round(seconds);
  if (whole < 120) return `${whole} с`;
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest ? `${minutes} мин ${rest} с` : `${minutes} мин`;
}

/**
 * Says why an attempt failed.
 * @param reason The reason the pipeline saved.
 * @param seconds How long the attempt took.
 * @param status HTTP status, if the service sent one.
 * @returns For example "хост перегружен (429)".
 */
function reasonText(reason: FailureReason, seconds: number, status: number | undefined): string {
  const http = status ? ` (HTTP ${status})` : '';
  switch (reason) {
    case 'timeout':
      return `нет ответа ${formatDuration(seconds)}`;
    case 'rate-limited':
      return 'хост перегружен (429)';
    case 'refused':
      return `отказ${http}`;
    case 'server':
      return `ошибка сервиса${http}`;
    case 'bad-answer':
      return `испорченный ответ через ${formatDuration(seconds)}`;
  }
}

/**
 * Names a part of a long text.
 * @param where The part and how many there are; missing for a text sent in one request.
 * @returns For example ", часть 2 из 4", or nothing.
 */
function partText(where: Partial<PartOf>): string {
  return where.part && where.parts && where.parts > 1 ? `, часть ${where.part} из ${where.parts}` : '';
}

/**
 * Chooses the Russian word for "parts" after a number.
 * @param count How many parts.
 * @returns "часть", "части" or "частей".
 */
function partsWord(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (last === 1 && lastTwo !== 11) return 'часть';
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return 'части';
  return 'частей';
}

/** What the translator did next, as the admin page says it. */
const AFTER_FAILURE: Record<AfterFailure, string> = {
  retry: 'повтор',
  'next-model': 'следующая модель',
  'no-models-left': 'модели закончились',
  'no-time-left': 'время на перевод вышло',
};

/**
 * Describes one step of a run.
 * @param event The step.
 * @returns Its text and technical detail.
 */
export function describeEvent(event: ProcessEvent): { text: string; detail: string } {
  switch (event.type) {
    case 'started':
      return { text: 'Обработка началась', detail: '' };
    case 'voiced':
      return { text: `Озвучка готова за ${formatDuration(event.seconds)}`, detail: '' };
    case 'attempt': {
      const model = translationModelLabel(event.model);
      // The first attempts of all parts start together, so they are told as one line.
      if (event.attempt === 1 && event.parts && event.parts > 1) {
        return { text: `Перевод: ${model}, ${event.parts} ${partsWord(event.parts)} одновременно`, detail: '' };
      }
      return { text: `Перевод: ${model}${partText(event)}, попытка ${event.attempt}`, detail: '' };
    }
    case 'failed':
      return {
        text:
          `${translationModelLabel(event.model)}${partText(event)}: ` +
          `${reasonText(event.reason, event.seconds, event.status)} → ${AFTER_FAILURE[event.then]}`,
        detail: event.detail,
      };
    case 'translated':
      return {
        text: `Перевод готов за ${formatDuration(event.seconds)} (${translationModelLabel(event.model)})`,
        detail: '',
      };
    case 'ready':
      return { text: 'Текст готов', detail: '' };
    case 'error':
      return { text: 'Обработка не удалась', detail: '' };
    case 'stopped':
      return { text: 'Запуск на GitHub остановлен: отменён или кончилось время', detail: '' };
  }
}

/**
 * Turns a whole log into lines for the page.
 * @param log The text's log.
 * @returns One line per step, in order.
 */
export function logLines(log: ProcessEvent[]): LogLine[] {
  // The first part's first attempt stands for all parts (see describeEvent).
  const shown = log.filter((event) => !(event.type === 'attempt' && event.attempt === 1 && (event.part ?? 1) > 1));
  return shown.map((event) => ({
    time: new Date(event.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    ...describeEvent(event),
  }));
}
