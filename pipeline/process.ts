// Command line entry for processing one text; the process-text workflow runs it in GitHub Actions.
//
// Usage: node pipeline/process.ts --title "Title" --text-file text.txt [--dry-run out-folder]
// Settings come from environment variables: OPENROUTER_API_KEY (required), TTS_VOICE, TRANSLATION_MODELS,
// and NETLIFY_SITE_ID with NETLIFY_AUTH_TOKEN (not needed with --dry-run, which writes files instead of storage).

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { TextDoc } from '../shared/text-doc.ts';
import { processText } from './core/process-text.ts';
import { normalizeSource } from './core/split.ts';
import { netlifyStorage } from './store.ts';
import { createOpenRouter, parseModels } from './translate/openrouter.ts';
import { kokoro } from './tts/kokoro.ts';
import { resolveVoice } from './tts/voices.ts';

/**
 * Reads a required environment variable.
 * @param name Variable name.
 * @returns Its value.
 * @throws If it is missing or empty.
 */
function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`The setting ${name} is missing.`);
  return value;
}

/** Runs the pipeline for one text and reports step times. */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      title: { type: 'string' },
      'text-file': { type: 'string' },
      'dry-run': { type: 'string' },
    },
  });
  if (!values.title || !values['text-file']) {
    throw new Error('Usage: node pipeline/process.ts --title "Title" --text-file text.txt [--dry-run out-folder]');
  }
  const text = await readFile(values['text-file'], 'utf8');
  const dryRunDir = values['dry-run'];

  // A dry run keeps only the latest version of each file, the same way storage does.
  const files = new Map<string, Buffer | string>();
  const storage = dryRunDir
    ? {
        saveDoc: async (doc: TextDoc) => void files.set(`${doc.id}.json`, JSON.stringify(doc, null, 1)),
        saveAudio: async (key: string, mp3: Buffer) => void files.set(key, mp3),
      }
    : netlifyStorage(required('NETLIFY_SITE_ID'), required('NETLIFY_AUTH_TOKEN'));

  try {
    const result = await processText(
      { title: values.title, text },
      {
        tts: kokoro,
        voice: resolveVoice(process.env.TTS_VOICE),
        translator: createOpenRouter({
          apiKey: required('OPENROUTER_API_KEY'),
          models: parseModels(process.env.TRANSLATION_MODELS),
        }),
        saveDoc: (doc) => storage.saveDoc(doc),
        saveAudio: (key, mp3) => storage.saveAudio(key, mp3),
      },
    );
    const { doc, seconds } = result;
    const lastSentence = doc.sentences[doc.sentences.length - 1];
    const report = [
      `Text "${doc.title}" is ready: id ${doc.id}`,
      `${normalizeSource(text).length} characters, ${doc.sentences.length} sentences, ` +
        `${(lastSentence?.end ?? 0).toFixed(1)} s of audio, voice ${doc.tts.voice}, model ${doc.translation.model}`,
      `Time: voice ${seconds.voice.toFixed(1)} s, translation ${seconds.translation.toFixed(1)} s, ` +
        `total ${seconds.total.toFixed(1)} s`,
    ];
    console.log(report.join('\n'));
    if (process.env.GITHUB_STEP_SUMMARY) {
      await appendFile(process.env.GITHUB_STEP_SUMMARY, report.map((line) => `- ${line}`).join('\n') + '\n');
    }
  } finally {
    if (dryRunDir) {
      await mkdir(dryRunDir, { recursive: true });
      for (const [name, content] of files) await writeFile(path.join(dryRunDir, name), content);
    }
  }
}

try {
  await main();
  // A pending fallback retry timer must not keep the run alive after the work is done.
  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
