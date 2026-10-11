// The voices the site may use (chosen by ear in stage 1) and the default one.
// The default can be changed without code: set the TTS_VOICE variable in GitHub to any id below.

/** A voice that can be used for a text. */
export interface VoiceOption {
  /** Kokoro voice id. */
  id: string;
  /** Short human description for lists and error messages. */
  label: string;
}

/** Every allowed voice. To allow another Kokoro voice, add it here. */
export const VOICES: readonly VoiceOption[] = [
  { id: 'af_heart', label: 'American, female' },
  { id: 'af_sky', label: 'American, female' },
  { id: 'am_adam', label: 'American, male' },
  { id: 'am_eric', label: 'American, male' },
  { id: 'am_liam', label: 'American, male' },
];

/** Voice used when TTS_VOICE is not set. */
export const DEFAULT_VOICE = 'am_liam';

/**
 * Picks the voice to use from a setting such as TTS_VOICE.
 * @param setting The setting's value; empty or missing means "use the default".
 * @returns A voice id from VOICES.
 * @throws If the setting names a voice that is not in VOICES.
 */
export function resolveVoice(setting: string | undefined): string {
  const voice = setting?.trim() || DEFAULT_VOICE;
  if (!VOICES.some((option) => option.id === voice)) {
    const allowed = VOICES.map((option) => `${option.id} (${option.label})`).join(', ');
    throw new Error(`Unknown voice "${voice}". Allowed voices: ${allowed}.`);
  }
  return voice;
}
