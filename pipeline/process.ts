// Command line entry for processing one text; the process-text workflow runs it in GitHub Actions.
//
// Usage:
//   node pipeline/process.ts --id <text id>
//     Processes a text the admin saved in storage. Needs NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN.
//   node pipeline/process.ts --dry-run <out-folder> --title "Title" --text-file text.txt [--voice kokoro:am_liam]
//     [--model openrouter:<model id>]
//     Processes a local file and writes the JSON and mp3 to a folder instead of storage. --model checks how
//     a model from shared/translation-models.ts translates; the others still follow it if it fails.
// The voice and the translation model come with each text; the only setting is the OPENROUTER_API_KEY secret.

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { checkTextInput, ID_PATTERN, newTextDoc } from '../shared/new-text.ts';
import type { TextDoc } from '../shared/text-doc.ts';
import { DEFAULT_TRANSLATION_MODEL } from '../shared/translation-models.ts';
import { DEFAULT_VOICE } from '../shared/voices.ts';
import { processText } from './core/process-text.ts';
import { netlifyStorage, type TextStorage } from './store.ts';
import { createTranslator } from './translate/translators.ts';
import { getTtsProvider } from './tts/providers.ts';

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

/**
 * Storage that keeps documents and audio in memory and writes them to a folder at the end, for dry runs.
 * @returns The storage and a function that writes everything saved so far.
 */
function folderStorage(): { storage: TextStorage; writeTo: (folder: string) => Promise<void> } {
  const files = new Map<string, Buffer | string>();
  return {
    storage: {
      getDoc: async () => null,
      saveDoc: async (doc) => void files.set(`${doc.id}.json`, JSON.stringify(doc, null, 1)),
      saveAudio: async (key, mp3) => void files.set(key, mp3),
    },
    async writeTo(folder) {
      await mkdir(folder, { recursive: true });
      for (const [name, content] of files) await writeFile(path.join(folder, name), content);
    },
  };
}

/** Runs the pipeline for one text and reports step times. */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      id: { type: 'string' },
      'dry-run': { type: 'string' },
      title: { type: 'string' },
      'text-file': { type: 'string' },
      voice: { type: 'string' },
      model: { type: 'string' },
    },
  });

  let storage: TextStorage;
  let doc: TextDoc;
  let finish = async () => {};
  if (values.id !== undefined) {
    // The id comes from the workflow input; checking its shape keeps anything else away from storage.
    if (!ID_PATTERN.test(values.id)) throw new Error(`Invalid text id "${values.id}".`);
    storage = netlifyStorage(required('NETLIFY_SITE_ID'), required('NETLIFY_AUTH_TOKEN'));
    const saved = await storage.getDoc(values.id);
    if (!saved) throw new Error(`Text "${values.id}" is not in storage.`);
    doc = saved;
  } else if (values['dry-run'] && values.title && values['text-file']) {
    const input = {
      title: values.title,
      text: await readFile(values['text-file'], 'utf8'),
      voice: values.voice ?? DEFAULT_VOICE,
      translationModel: values.model ?? DEFAULT_TRANSLATION_MODEL,
    };
    const problems = checkTextInput(input);
    if (problems.length > 0) throw new Error(problems.join(' '));
    const folder = folderStorage();
    storage = folder.storage;
    doc = newTextDoc(input);
    const out = values['dry-run'];
    finish = () => folder.writeTo(out);
  } else {
    throw new Error(
      'Usage: node pipeline/process.ts --id <text id>\n' +
        '   or: node pipeline/process.ts --dry-run <out-folder> --title "Title" --text-file text.txt ' +
        '[--voice kokoro:am_liam] [--model openrouter:<model id>]',
    );
  }

  let services;
  try {
    services = {
      tts: getTtsProvider(doc.tts.provider),
      translator: createTranslator(doc.translation.provider, doc.translation.preferred, process.env),
    };
  } catch (error) {
    // Save the real reason now; otherwise the text would only get the general "run stopped" message.
    const message = error instanceof Error ? error.message : String(error);
    const at = new Date().toISOString();
    await storage.saveDoc({ ...doc, status: 'error', error: message, updatedAt: at, log: [{ type: 'error', at }] });
    throw error;
  }

  try {
    const { doc: ready, seconds } = await processText(doc, {
      ...services,
      saveDoc: (next) => storage.saveDoc(next),
      saveAudio: (key, mp3) => storage.saveAudio(key, mp3),
      // The same steps the admin page shows, in the workflow log too.
      onEvent: (event) => console.log(`Step: ${JSON.stringify(event)}`),
    });
    const lastSentence = ready.sentences[ready.sentences.length - 1];
    const report = [
      `Text "${ready.title}" is ready: id ${ready.id}`,
      `${ready.source.length} characters, ${ready.sentences.length} sentences, ` +
        `${(lastSentence?.end ?? 0).toFixed(1)} s of audio, voice ${ready.tts.provider}:${ready.tts.voice}, ` +
        `model ${ready.translation.model}`,
      `Time: voice ${seconds.voice.toFixed(1)} s, translation ${seconds.translation.toFixed(1)} s, ` +
        `total ${seconds.total.toFixed(1)} s`,
    ];
    console.log(report.join('\n'));
    if (process.env.GITHUB_STEP_SUMMARY) {
      await appendFile(process.env.GITHUB_STEP_SUMMARY, report.map((line) => `- ${line}`).join('\n') + '\n');
    }
  } finally {
    await finish();
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
