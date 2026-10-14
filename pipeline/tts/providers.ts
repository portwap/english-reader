// The list of voice adapters, so a text is voiced by the provider of the voice chosen for it.
// To add a voice service: write its adapter, add it here, and add its voices to shared/voices.ts.

import { kokoro } from './kokoro.ts';
import type { TtsProvider } from './provider.ts';

const PROVIDERS: readonly TtsProvider[] = [kokoro];

/**
 * Finds the voice adapter for a provider.
 * @param id Provider id, as saved in TextDoc.tts.provider.
 * @returns The adapter.
 * @throws If no adapter has this id.
 */
export function getTtsProvider(id: string): TtsProvider {
  const provider = PROVIDERS.find((candidate) => candidate.id === id);
  if (!provider) throw new Error(`No voice adapter for provider "${id}".`);
  return provider;
}
