// The data contract: one processed text as the site stores and shows it.
// The pipeline writes it, the API returns it, the pages read it; nothing else is shared.

/** Where a text is in processing. */
export type TextStatus = 'processing' | 'ready' | 'error';

/** One spoken word of a sentence. */
export interface DocWord {
  /** The word exactly as written in the text. */
  text: string;
  /** Start and end of the word in the audio, in seconds. */
  start: number;
  end: number;
  /** Position of the word inside its sentence's text, so the page can keep punctuation around it. */
  at: number;
}

/** One sentence with its translation and timings. */
export interface DocSentence {
  /** The sentence exactly as written, without surrounding spaces. */
  text: string;
  /** Russian translation of the sentence, made with the whole text as context. */
  translation: string;
  /** Number of the paragraph the sentence belongs to, from 0. */
  paragraph: number;
  /** Start of the first word and end of the last word, in seconds. */
  start: number;
  end: number;
  words: DocWord[];
}

/** A text and everything the site needs to show and play it. */
export interface TextDoc {
  schemaVersion: 1;
  id: string;
  title: string;
  /** ISO 8601 time when the text was added. */
  createdAt: string;
  /** ISO 8601 time of the last change of status; tells how long a text has been processing. */
  updatedAt?: string;
  status: TextStatus;
  /** Why processing failed; set only when status is 'error'. */
  error?: string;
  /** The original text as pasted, kept so it can be edited and processed again. */
  source: string;
  tts: { provider: string; voice: string };
  /**
   * Translation service; the model the admin chose (tried first); and the model that made the translations
   * (empty until ready; another model if the chosen one failed).
   */
  translation: { provider: string; model: string; preferred?: string };
  /** Storage key of the mp3; empty until the text is ready. */
  audio: string;
  /** Empty until the text is ready. */
  sentences: DocSentence[];
  /** What the last run did, step by step, for the admin page; missing until a run starts. */
  log?: ProcessEvent[];
}

/** Why one translation attempt failed. */
export type FailureReason = 'timeout' | 'rate-limited' | 'refused' | 'server' | 'bad-answer';

/** What the translator does after a failed attempt. */
export type AfterFailure = 'retry' | 'next-model' | 'no-models-left' | 'no-time-left';

/** One step of a processing run, written as it happens so the admin can follow the run. */
export type ProcessEvent = { at: string } & (
  | { type: 'started' }
  | { type: 'voiced'; seconds: number }
  | { type: 'attempt'; model: string; attempt: number }
  | {
      type: 'failed';
      model: string;
      attempt: number;
      seconds: number;
      reason: FailureReason;
      /** HTTP status, when the service answered with an error. */
      status?: number;
      then: AfterFailure;
      /** Short technical detail in English, such as the start of a broken answer. */
      detail: string;
    }
  | { type: 'translated'; model: string; seconds: number }
  | { type: 'ready' }
  | { type: 'error' }
  | { type: 'stopped' }
);

/** Removes the time from each kind of event separately, so the kinds stay apart. */
type WithoutTime<E> = E extends unknown ? Omit<E, 'at'> : never;

/** An event before its time is added. */
export type ProcessStep = WithoutTime<ProcessEvent>;

/** Short facts about a text, stored next to it so the list of texts loads without reading every text. */
export interface TextSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt?: string;
  status: TextStatus;
  /** Start of the error message, for the admin list. */
  error?: string;
}
