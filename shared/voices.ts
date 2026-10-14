// The voices a text can be read with. Each voice names its provider, so another voice service
// can be added next to Kokoro later: add its adapter and its voices here; old texts keep theirs.

/** A voice that can be chosen for a text. */
export interface VoiceOption {
  /** Voice service, the same as TtsProvider.id, for example 'kokoro'. */
  provider: string;
  /** The service's own voice id. */
  id: string;
  /** Short human description for lists. */
  label: string;
}

/** Every allowed voice (chosen by ear in stage 1). */
export const VOICES: readonly VoiceOption[] = [
  { provider: 'kokoro', id: 'af_heart', label: 'American, female' },
  { provider: 'kokoro', id: 'af_sky', label: 'American, female' },
  { provider: 'kokoro', id: 'am_adam', label: 'American, male' },
  { provider: 'kokoro', id: 'am_eric', label: 'American, male' },
  { provider: 'kokoro', id: 'am_liam', label: 'American, male' },
];

/**
 * Gives one string that names a voice together with its provider, for forms and the API.
 * @param voice A voice.
 * @returns A key such as "kokoro:am_liam".
 */
export function voiceKey(voice: { provider: string; id: string }): string {
  return `${voice.provider}:${voice.id}`;
}

/** The voice chosen in the admin form until another one is picked. */
export const DEFAULT_VOICE = 'kokoro:am_liam';

/**
 * Finds an allowed voice by its key.
 * @param key A key from voiceKey.
 * @returns The voice, or undefined if the key is not in VOICES.
 */
export function findVoice(key: string): VoiceOption | undefined {
  return VOICES.find((voice) => voiceKey(voice) === key);
}
