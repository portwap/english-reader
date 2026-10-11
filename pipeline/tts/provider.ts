// The voice interface: what every text-to-speech adapter must provide.
// The rest of the pipeline uses only this, so a voice service can be swapped by adding one adapter.

/** One spoken word and when it sounds, in seconds from the start of the audio. */
export interface TimedWord {
  text: string;
  start: number;
  end: number;
}

/** What an adapter returns for one text. */
export interface TtsResult {
  /** The whole text as one mp3 file. */
  mp3: Buffer;
  /** Length of the audio in seconds; word timings must fit inside it. */
  duration: number;
  /** Spoken words in order, with their timings. */
  words: TimedWord[];
}

/** A text-to-speech service, such as Kokoro. */
export interface TtsProvider {
  /** Short name of the service, saved with each text, for example 'kokoro'. */
  id: string;
  /**
   * Voices a text.
   * @param text English text to read aloud.
   * @param voice Voice id of this service, for example 'af_heart'.
   * @returns The mp3, its duration and the timed words.
   */
  synthesize(text: string, voice: string): Promise<TtsResult>;
}
