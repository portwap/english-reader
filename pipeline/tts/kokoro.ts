// Kokoro voice adapter: runs the Python script for speech and word timings, then ffmpeg for mp3.
// This is the only file that knows how Kokoro is called.

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { TimedWord, TtsProvider, TtsResult } from './provider.ts';

const run = promisify(execFile);

const SCRIPT = fileURLToPath(new URL('../python/kokoro_tts.py', import.meta.url));

/** Python interpreter to use; the PYTHON variable lets a machine point to its own. */
const PYTHON = process.env.PYTHON ?? 'python3';

/** Kokoro and ffmpeg log a lot; this keeps a long text from overflowing the default buffer. */
const MAX_LOG = 64 * 1024 * 1024;

/** Shape of the JSON file written by kokoro_tts.py. */
interface ScriptOutput {
  duration: number;
  words: TimedWord[];
}

/** Voices English text with Kokoro-82M. */
export const kokoro: TtsProvider = {
  id: 'kokoro',

  /**
   * Voices a text with one Kokoro voice.
   * @param text English text to read aloud.
   * @param voice Kokoro voice id, for example 'af_heart' or 'bm_george'.
   * @returns The mp3, its duration and the timed words.
   */
  async synthesize(text: string, voice: string): Promise<TtsResult> {
    const dir = await mkdtemp(path.join(tmpdir(), 'kokoro-'));
    try {
      const textFile = path.join(dir, 'text.txt');
      const wavFile = path.join(dir, 'audio.wav');
      const wordsFile = path.join(dir, 'words.json');
      const mp3File = path.join(dir, 'audio.mp3');
      await writeFile(textFile, text, 'utf8');

      await run(
        PYTHON,
        [SCRIPT, '--voice', voice, '--text', textFile, '--wav', wavFile, '--words', wordsFile],
        { maxBuffer: MAX_LOG },
      );
      // Mono 64 kbit/s is plenty for speech and keeps files small; 24 kHz is Kokoro's own rate.
      await run(
        'ffmpeg',
        ['-y', '-loglevel', 'error', '-i', wavFile, '-ac', '1', '-ar', '24000', '-c:a', 'libmp3lame', '-b:a', '64k', mp3File],
        { maxBuffer: MAX_LOG },
      );

      const output = JSON.parse(await readFile(wordsFile, 'utf8')) as ScriptOutput;
      return { mp3: await readFile(mp3File), duration: output.duration, words: output.words };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
};
