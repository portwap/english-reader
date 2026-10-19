// OpenRouter translation adapter: one request per text, with a retry and fallback models, within a time limit.
// This is the only file that knows how OpenRouter is called.

import type { AfterFailure, FailureReason } from '../../shared/text-doc.ts';
import type { TranslateOptions, TranslationResult, Translator } from './translator.ts';

const API_URL = 'https://openrouter.ai/api/v1/chat/completions';

const SYSTEM_PROMPT = `You translate English texts into Russian for people who are learning English.
You get the whole text and its sentences, numbered. Translate every numbered sentence into natural, correct Russian.
Use the whole text as context: speakers, pronouns, tense, names and terms must stay consistent across sentences.
Translate the meaning the way a skilled Russian translator would, not word for word: idioms and phrasal verbs
must sound like natural Russian (for example, "make up your mind" is "решиться", not "составить свой ум").
Follow Russian punctuation, not English: quotation marks «» (with „“ inside them), Russian rules for direct speech
(«Текст», — сказал он. / «Текст, — сказал он, — текст».), and the long dash where Russian needs it.
Give exactly one translation per numbered sentence: do not merge, split, skip or add sentences.
Answer with JSON only, in this form: {"translations":[{"n":1,"ru":"..."},{"n":2,"ru":"..."}]}`;

/** JSON schema of the answer, so models that support structured output return exactly this shape. */
const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    translations: {
      type: 'array',
      items: {
        type: 'object',
        properties: { n: { type: 'integer' }, ru: { type: 'string' } },
        required: ['n', 'ru'],
        additionalProperties: false,
      },
    },
  },
  required: ['translations'],
  additionalProperties: false,
};

/** Settings for the OpenRouter adapter. */
export interface OpenRouterOptions {
  apiKey: string;
  /** Models to try in order (see modelsToTry in shared/translation-models.ts). */
  models: string[];
  /** Pause before a retry of the same model, in milliseconds. */
  retryDelayMs?: number;
  /** Longest wait for one answer, in milliseconds. A busy free model once took 4.5 minutes for 2,500 characters. */
  timeoutMs?: number;
  /** Longest time for the whole translation, all attempts together; the workflow step has a longer limit. */
  budgetMs?: number;
  /** Replaceable for tests. */
  fetch?: typeof globalThis.fetch;
}

/** Attempts per model: the first one and one retry. */
const ATTEMPTS_PER_MODEL = 2;

/**
 * Failures worth one more try with the same model, because they are often one-off.
 * A rate limit (429) or a refusal (another 4xx) does not pass in seconds, so the next model is tried at once.
 */
const RETRYABLE: ReadonlySet<FailureReason> = new Set(['timeout', 'server', 'bad-answer']);

/**
 * Builds the user message: the whole text for context, then the numbered sentences.
 * @param fullText The whole English text.
 * @param sentences Its sentences, in order.
 * @returns The message text.
 */
export function buildPrompt(fullText: string, sentences: string[]): string {
  const numbered = sentences.map((sentence, i) => `${i + 1}. ${sentence}`).join('\n');
  return `Whole text:\n"""\n${fullText}\n"""\n\nSentences to translate (${sentences.length}):\n${numbered}`;
}

/**
 * Reads the model's answer and turns it into one translation per sentence.
 * @param content The text of the model's answer.
 * @param count How many sentences were sent.
 * @returns Translations in sentence order.
 * @throws If the answer is not the expected JSON or does not cover every sentence once.
 */
export function parseAnswer(content: string, count: number): string[] {
  // Some models wrap JSON in a code block or add a word before it; take the outermost object.
  const first = content.indexOf('{');
  const last = content.lastIndexOf('}');
  if (first < 0 || last < first) throw new Error('the answer has no JSON object');
  const data = JSON.parse(content.slice(first, last + 1)) as { translations?: unknown };
  if (!Array.isArray(data.translations)) throw new Error('the answer has no "translations" list');

  const byNumber = new Map<number, string>();
  for (const item of data.translations as { n?: unknown; ru?: unknown }[]) {
    if (typeof item?.n !== 'number' || typeof item.ru !== 'string') throw new Error('an item is not {n, ru}');
    if (byNumber.has(item.n)) throw new Error(`sentence ${item.n} is translated twice`);
    byNumber.set(item.n, item.ru.trim());
  }
  const translations = Array.from({ length: count }, (_, i) => byNumber.get(i + 1) ?? '');
  // Extra numbers (outside 1..count) also make the sizes differ, so they are caught here too.
  if (byNumber.size !== count) throw new Error(`${byNumber.size} translations for ${count} sentences`);
  const empty = translations.flatMap((translation, i) => (translation ? [] : [i + 1]));
  if (empty.length > 0) throw new Error(`no translation for sentence ${empty.join(', ')}`);
  return translations;
}

/** Error from OpenRouter with the HTTP status, so a rate limit is told apart from other failures. */
class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** An answer that came back but cannot be used: not JSON, cut off, or not one translation per sentence. */
class BadAnswer extends Error {}

/**
 * Sorts a failed attempt into a reason the admin page can show.
 * @param error What the attempt threw.
 * @returns The reason, and the HTTP status if the service sent one.
 */
function classify(error: unknown): { reason: FailureReason; status?: number } {
  if (error instanceof ApiError) {
    if (error.status === 429) return { reason: 'rate-limited', status: error.status };
    if (error.status >= 500 || error.status === 408) return { reason: 'server', status: error.status };
    return { reason: 'refused', status: error.status };
  }
  if (error instanceof BadAnswer) return { reason: 'bad-answer' };
  // AbortSignal.timeout rejects with a DOMException named TimeoutError.
  if ((error as { name?: unknown } | null)?.name === 'TimeoutError') return { reason: 'timeout' };
  // Network failures and errors the service reports inside an answer without a code.
  return { reason: 'server' };
}

/**
 * Creates the OpenRouter translator.
 * @param options API key and optional settings.
 * @returns A Translator that tries each model in turn, within the time limit.
 */
export function createOpenRouter(options: OpenRouterOptions): Translator {
  const models = options.models;
  const retryDelayMs = options.retryDelayMs ?? 5000;
  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;
  const budgetMs = options.budgetMs ?? 15 * 60 * 1000;
  const doFetch = options.fetch ?? globalThis.fetch;

  /**
   * Sends one request to one model.
   * @param model Model id.
   * @param fullText The whole text.
   * @param sentences Its sentences.
   * @param waitMs Longest wait for the answer.
   * @param sessionId Groups the requests of one text in OpenRouter's logs.
   * @returns One translation per sentence.
   */
  async function ask(
    model: string,
    fullText: string,
    sentences: string[],
    waitMs: number,
    sessionId: string | undefined,
  ): Promise<string[]> {
    const response = await doFetch(API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'english-reader',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildPrompt(fullText, sentences) },
        ],
        temperature: 0.2,
        // A little reasoning helps with context; leaving it out of the answer keeps the JSON clean.
        reasoning: { effort: 'low', exclude: true },
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'translations', strict: true, schema: ANSWER_SCHEMA },
        },
        ...(sessionId ? { session_id: sessionId } : {}),
      }),
      signal: AbortSignal.timeout(waitMs),
    });
    const body = await response.text();
    if (!response.ok) throw new ApiError(response.status, `HTTP ${response.status}: ${body.slice(0, 300)}`);

    let data: {
      error?: { message?: string; code?: unknown };
      choices?: { message?: { content?: string }; finish_reason?: string; error?: { message?: string; code?: unknown } }[];
    };
    try {
      data = JSON.parse(body) as typeof data;
    } catch {
      throw new BadAnswer(`the reply is not JSON: ${JSON.stringify(body.slice(0, 120))}`);
    }
    const choice = data.choices?.[0];
    const problem = data.error ?? choice?.error;
    if (problem) {
      // An error can also come inside a 200 reply; its code tells a rate limit from the rest.
      const message = problem.message ?? 'the service reported an error';
      if (typeof problem.code === 'number') throw new ApiError(problem.code, message);
      throw new Error(message);
    }
    if (choice?.finish_reason === 'length') throw new BadAnswer('the answer was cut off (too long)');
    const content = choice?.message?.content ?? '';
    try {
      return parseAnswer(content, sentences.length);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BadAnswer(`${message}; the answer starts with ${JSON.stringify(content.slice(0, 120))}`);
    }
  }

  return {
    id: 'openrouter',

    /**
     * Translates the sentences, trying each model in turn until one gives a usable answer or time runs out.
     * @param fullText The whole English text.
     * @param sentences Its sentences, in order.
     * @param translateOptions Session id and progress reports.
     * @returns One translation per sentence and the model that made them.
     * @throws If no model gave a usable answer in time; each failure was reported through onEvent.
     */
    async translate(
      fullText: string,
      sentences: string[],
      translateOptions: TranslateOptions = {},
    ): Promise<TranslationResult> {
      const report = translateOptions.onEvent ?? (() => {});
      const deadline = Date.now() + budgetMs;
      for (const [index, model] of models.entries()) {
        for (let attempt = 1; attempt <= ATTEMPTS_PER_MODEL; attempt++) {
          report({ type: 'attempt', model, attempt });
          const started = Date.now();
          try {
            const waitMs = Math.max(1, Math.min(timeoutMs, deadline - started));
            return { translations: await ask(model, fullText, sentences, waitMs, translateOptions.sessionId), model };
          } catch (error) {
            const { reason, status } = classify(error);
            const retry = attempt < ATTEMPTS_PER_MODEL && RETRYABLE.has(reason);
            let then: AfterFailure = retry ? 'retry' : 'next-model';
            if (!retry && index === models.length - 1) then = 'no-models-left';
            else if (Date.now() + (retry ? retryDelayMs : 0) >= deadline) then = 'no-time-left';
            report({
              type: 'failed',
              model,
              attempt,
              seconds: Math.round((Date.now() - started) / 100) / 10,
              reason,
              ...(status === undefined ? {} : { status }),
              then,
              detail: (error instanceof Error ? error.message : String(error)).slice(0, 300),
            });
            if (then === 'no-models-left') throw new Error('Translation failed: no model gave a usable answer.');
            if (then === 'no-time-left') throw new Error('Translation failed: the time for translation ran out.');
            if (!retry) break;
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          }
        }
      }
      throw new Error('Translation failed: there are no models to try.');
    },
  };
}
