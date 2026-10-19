// Turns the processing log of a text into short Russian lines for the admin page.
// Kept apart from the page code, so the wording can be tested without a browser.

import type { FailureReason, AfterFailure, ProcessEvent } from '../../../shared/text-doc.ts';
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
    case 'attempt':
      return { text: `Перевод: ${translationModelLabel(event.model)}, попытка ${event.attempt}`, detail: '' };
    case 'failed':
      return {
        text: `${translationModelLabel(event.model)}: ${reasonText(event.reason, event.seconds, event.status)} → ${AFTER_FAILURE[event.then]}`,
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
  return log.map((event) => ({
    time: new Date(event.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    ...describeEvent(event),
  }));
}
