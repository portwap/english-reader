// Voice check (temporary, stage 1): voices the sample with every English Kokoro voice
// and builds a listening page with word highlight. Removed once a voice is chosen.
//
// Usage: node pipeline/voice-check/run.ts [output folder, default out/voice-check]

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { kokoro } from '../tts/kokoro.ts';
import type { TimedWord } from '../tts/provider.ts';

/** All English Kokoro-82M voices. First letter: a = American, b = British; second: f = female, m = male. */
const VOICES = [
  'af_heart', 'af_alloy', 'af_aoede', 'af_bella', 'af_jessica', 'af_kore', 'af_nicole', 'af_nova',
  'af_river', 'af_sarah', 'af_sky',
  'am_adam', 'am_echo', 'am_eric', 'am_fenrir', 'am_liam', 'am_michael', 'am_onyx', 'am_puck', 'am_santa',
  'bf_alice', 'bf_emma', 'bf_isabella', 'bf_lily',
  'bm_daniel', 'bm_fable', 'bm_george', 'bm_lewis',
];

/** What the listening page needs to know about one voice. */
interface VoiceReport {
  voice: string;
  /** Path of the mp3, relative to the page; empty if voicing failed. */
  audio: string;
  /** Audio length in seconds. */
  duration: number;
  /** How long voicing took, in seconds. */
  processing: number;
  words: TimedWord[];
  /** Timing problems found; empty means the timings look right. */
  problems: string[];
  error?: string;
}

/**
 * Counts the words a reader sees in a text: pieces between spaces and dashes that hold a letter or digit.
 * @param text Plain text.
 * @returns Number of words.
 */
function countWords(text: string): number {
  return text.split(/[\s—–]+/).filter((piece) => /[\p{L}\p{N}]/u.test(piece)).length;
}

/**
 * Checks that word timings can drive a highlight: each word has a real span,
 * words go in order, and none runs past the end of the audio.
 * @param words Timed words from the voice adapter.
 * @param duration Audio length in seconds.
 * @returns A list of problems; empty when all is well.
 */
function checkTimings(words: TimedWord[], duration: number): string[] {
  const problems: string[] = [];
  if (words.length === 0) problems.push('no timed words');
  let previousStart = 0;
  for (const [i, word] of words.entries()) {
    if (word.end <= word.start) problems.push(`#${i} "${word.text}": ends before it starts`);
    if (word.start < previousStart) problems.push(`#${i} "${word.text}": starts before the previous word`);
    // A few milliseconds of rounding is fine; more means the timing is wrong.
    if (word.end > duration + 0.05) problems.push(`#${i} "${word.text}": ends after the audio`);
    previousStart = word.start;
  }
  return problems;
}

/**
 * Builds the listening page: a voice list, the text with word highlight, and an audio player.
 * @param reports One report per voice.
 * @param textWords Word count of the sample, shown next to each voice's count.
 * @returns The whole HTML page.
 */
function buildPage(reports: VoiceReport[], textWords: number): string {
  // Escaping "<" keeps the JSON from closing the script tag early.
  const data = JSON.stringify({ reports, textWords }).replaceAll('<', '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kokoro voice check</title>
<style>
  body { margin: 0; font-family: system-ui, sans-serif; color: #222; background: #fafafa; }
  main { max-width: 760px; margin: 0 auto; padding: 16px; }
  .voices { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; }
  .voices button { font: inherit; padding: 6px 10px; border: 1px solid #ccc; border-radius: 6px; background: #fff; cursor: pointer; }
  .voices button.current { border-color: #2563eb; background: #dbeafe; }
  .voices button.bad { color: #b91c1c; }
  audio { width: 100%; margin: 8px 0 16px; }
  .info { font-size: 14px; color: #555; }
  .problems { font-size: 14px; color: #b91c1c; }
  .text { font-size: 20px; line-height: 1.7; }
  .text span { cursor: pointer; border-radius: 4px; padding: 1px 2px; }
  .text span.now { background: #fde68a; }
</style>
</head>
<body>
<main>
  <h1>Kokoro voice check</h1>
  <p class="info">Pick a voice, press play, and watch the highlight. Click a word to jump to it.
  a = American, b = British; f = female, m = male.</p>
  <div class="voices" id="voices"></div>
  <p class="info" id="info"></p>
  <ul class="problems" id="problems"></ul>
  <audio id="player" controls preload="auto"></audio>
  <div class="text" id="text"></div>
</main>
<script id="data" type="application/json">${data}</script>
<script>
  const { reports, textWords } = JSON.parse(document.getElementById('data').textContent);
  const player = document.getElementById('player');
  const textBox = document.getElementById('text');
  let current = null;
  let spans = [];
  let lit = -1;

  // Index of the word sounding at time t, or -1 between words.
  function wordAt(words, t) {
    let lo = 0, hi = words.length - 1, found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (words[mid].start <= t) { found = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    return found >= 0 && t < words[found].end ? found : -1;
  }

  function highlight() {
    if (!current) return;
    const i = wordAt(current.words, player.currentTime);
    if (i !== lit) {
      if (lit >= 0) spans[lit].classList.remove('now');
      if (i >= 0) spans[i].classList.add('now');
      lit = i;
    }
    if (!player.paused) requestAnimationFrame(highlight);
  }

  function choose(report) {
    current = report;
    document.querySelectorAll('.voices button').forEach((b) => b.classList.toggle('current', b.dataset.voice === report.voice));
    document.getElementById('info').textContent = report.error
      ? report.voice + ': failed — ' + report.error
      : report.voice + ': ' + report.duration.toFixed(1) + ' s of audio, voiced in ' + report.processing.toFixed(1) +
        ' s, ' + report.words.length + ' timed words (text has ' + textWords + ')';
    const list = document.getElementById('problems');
    list.innerHTML = '';
    for (const p of report.problems) { const li = document.createElement('li'); li.textContent = p; list.append(li); }
    textBox.innerHTML = '';
    spans = report.words.map((w) => {
      const span = document.createElement('span');
      span.textContent = w.text;
      span.addEventListener('click', () => { player.currentTime = w.start; player.play(); });
      textBox.append(span, ' ');
      return span;
    });
    lit = -1;
    if (report.audio) player.src = report.audio; else player.removeAttribute('src');
  }

  const box = document.getElementById('voices');
  for (const report of reports) {
    const button = document.createElement('button');
    button.textContent = report.voice;
    button.dataset.voice = report.voice;
    if (report.error || report.problems.length) button.classList.add('bad');
    button.addEventListener('click', () => choose(report));
    box.append(button);
  }
  player.addEventListener('play', () => requestAnimationFrame(highlight));
  player.addEventListener('seeked', highlight);
  choose(reports[0]);
</script>
</body>
</html>
`;
}

/** Voices the sample with every voice, saves the mp3s and writes the listening page. */
async function main(): Promise<void> {
  const outDir = path.resolve(process.argv[2] ?? 'out/voice-check');
  const sample = await readFile(fileURLToPath(new URL('sample.txt', import.meta.url)), 'utf8');
  await mkdir(path.join(outDir, 'voices'), { recursive: true });

  const reports: VoiceReport[] = [];
  for (const voice of VOICES) {
    const started = performance.now();
    try {
      const result = await kokoro.synthesize(sample, voice);
      const audio = `voices/${voice}.mp3`;
      await writeFile(path.join(outDir, audio), result.mp3);
      const problems = checkTimings(result.words, result.duration);
      const processing = (performance.now() - started) / 1000;
      reports.push({ voice, audio, duration: result.duration, processing, words: result.words, problems });
      console.log(`${voice}: ${result.duration.toFixed(1)} s audio in ${processing.toFixed(1)} s, ` +
        `${result.words.length} words, ${problems.length} problems`);
    } catch (error) {
      // One broken voice should not stop the others; the page shows the error.
      const message = error instanceof Error ? error.message : String(error);
      const processing = (performance.now() - started) / 1000;
      reports.push({ voice, audio: '', duration: 0, processing, words: [], problems: [], error: message });
      console.error(`${voice}: failed: ${message}`);
    }
  }

  await writeFile(path.join(outDir, 'index.html'), buildPage(reports, countWords(sample)), 'utf8');
  console.log(`Page written to ${path.join(outDir, 'index.html')}`);
  if (reports.every((r) => r.error)) {
    throw new Error('Every voice failed; see the errors above.');
  }
}

await main();
