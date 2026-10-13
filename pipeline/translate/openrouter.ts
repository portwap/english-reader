// OpenRouter translation adapter: one request per text, with retry and a fallback model.
// This is the only file that knows how OpenRouter is called.

import type { TranslationResult, Translator } from './translator.ts';

const API_URL = 'https://openrouter.ai/api/v1/chat/completions';

/** Main model first, then the fallback; chosen by the WMT24++ translation ranking (see docs/PLAN.md). */
export const DEFAULT_MODELS = ['nvidia/nemotron-3-super-120b-a12b:free', 'google/gemma-4-31b-it:free'];

const SYSTEM_PROMPT = `You translate English texts into Russian for people who are learning English.
You get the whole text and its sentences, numbered. Translate every numbered sentence into natural, correct Russian.
Use the whole text as context: speakers, pronouns, tense, names and terms must stay consistent across sentences.
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
  /** Models to try in order. */
  models?: string[];
  /** Attempts per model; 2 means one retry. */
  attempts?: number;
  /** Pause before a retry, in milliseconds. Rate limits get a longer pause. */
  retryDelayMs?: number;
  /** Longest wait for one answer, in milliseconds; long texts on free models can be slow. */
  timeoutMs?: number;
  /** Replaceable for tests. */
  fetch?: typeof globalThis.fetch;
}

/**
 * Reads the TRANSLATION_MODELS setting: a comma-separated list of models.
 * @param setting The setting's value; empty or missing means the default models.
 * @returns Models in the order they should be tried.
 */
export function parseModels(setting: string | undefined): string[] {
  const models = (setting ?? '').split(',').map((model) => model.trim()).filter(Boolean);
  return models.length > 0 ? models : DEFAULT_MODELS;
}

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

/** Error from OpenRouter with the HTTP status, so rate limits can wait longer. */
class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Creates the OpenRouter translator.
 * @param options API key and optional settings.
 * @returns A Translator that tries each model in turn, with retries.
 */
export function createOpenRouter(options: OpenRouterOptions): Translator {
  const models = options.models ?? DEFAULT_MODELS;
  const attempts = options.attempts ?? 2;
  const retryDelayMs = options.retryDelayMs ?? 5000;
  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;
  const doFetch = options.fetch ?? globalThis.fetch;

  /**
   * Sends one request to one model.
   * @param model Model id.
   * @param fullText The whole text.
   * @param sentences Its sentences.
   * @returns One translation per sentence.
   */
  async function ask(model: string, fullText: string, sentences: string[]): Promise<string[]> {
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
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await response.text();
    if (!response.ok) throw new ApiError(response.status, `HTTP ${response.status}: ${body.slice(0, 300)}`);

    const data = JSON.parse(body) as {
      error?: { message?: string };
      choices?: { message?: { content?: string }; finish_reason?: string; error?: { message?: string } }[];
    };
    const choice = data.choices?.[0];
    const problem = data.error?.message ?? choice?.error?.message;
    if (problem) throw new Error(problem);
    if (choice?.finish_reason === 'length') throw new Error('the answer was cut off (too long)');
    return parseAnswer(choice?.message?.content ?? '', sentences.length);
  }

  return {
    id: 'openrouter',

    /**
     * Translates the sentences, trying each model in turn.
     * @param fullText The whole English text.
     * @param sentences Its sentences, in order.
     * @returns One translation per sentence and the model that made them.
     * @throws If every attempt with every model failed; the message lists each failure.
     */
    async translate(fullText: string, sentences: string[]): Promise<TranslationResult> {
      const failures: string[] = [];
      for (const model of models) {
        for (let attempt = 1; attempt <= attempts; attempt++) {
          try {
            return { translations: await ask(model, fullText, sentences), model };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            failures.push(`${model} (attempt ${attempt}): ${message}`);
            if (attempt < attempts) {
              const rateLimited = error instanceof ApiError && error.status === 429;
              await new Promise((resolve) => setTimeout(resolve, rateLimited ? retryDelayMs * 6 : retryDelayMs));
            }
          }
        }
      }
      throw new Error(`Translation failed. ${failures.join(' | ')}`);
    },
  };
}
