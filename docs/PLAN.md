# Plan

Facts about services are as of 2026-10-11. Re-check them before relying on them.

## What the site does

1. **Home page:** a list of texts with links to their pages.
2. **Admin page `/admin`:** login with email and password (one admin only), a form "Title, Text, Create", a list of texts with their status, delete and edit.
3. **Processing:** after a text is created, the site voices and translates it on its own, then the text page appears.
4. **Text page:**
   - play the whole text; the word being spoken is highlighted, exactly in sync with the voice;
   - play one sentence;
   - click a word to hear only that word (cut from the full recording);
   - show the Russian translation of a sentence with a button next to it. Each sentence is translated with the whole text as context. No whole-text translation.
5. **Design:** simple, clean, easy to read, works on phone and desktop.
6. **Out of scope:** speed controls (normal natural speed only), dictionaries, flashcards, other users.

Volume: 1–2 texts a day. Texts can be longer than 300 words; the form limit will be set from measurements, roughly up to 10,000 characters.

Budget: free if possible, at most 2–3 € a month.

## Architecture

- **Netlify:** site pages, admin login (Netlify Identity, invite-only), storage (Netlify Blobs: texts, translations, timings, mp3), API functions in TypeScript.
- **GitHub Actions:** processing of each text. Kokoro voices it with word timings, OpenRouter translates it. The result is written to Netlify Blobs.
- **OpenRouter:** translation with free models. Main: `google/gemma-4-31b-it:free`, fallback: `qwen/qwen3.8-27b:free`.

The path of one text:

1. The admin logs in at `/admin` and sends a title and a text.
2. A Netlify function saves the text with status `processing` and starts the GitHub Actions workflow through the GitHub API. The GitHub token (Actions permission on this repository only) is stored in Netlify settings.
3. The pipeline in Actions splits the text into sentences and words, voices it with Kokoro (word timings included) and translates the sentences through OpenRouter.
4. JSON and mp3 with status `ready` are written to Netlify Blobs, and the text appears on the home page. No site rebuild is needed.

## Modularity

The site knows only the data format. Voice and translation services plug in through adapters. Swapping a service means adding one adapter file and changing one setting.

### Data contract

```ts
type TextDoc = {
  schemaVersion: 1;
  id: string; title: string; createdAt: string;
  status: 'processing' | 'ready' | 'error'; error?: string;
  tts: { provider: string; voice: string };
  translation: { provider: string; model: string };
  audio: string;                 // mp3 key in storage
  sentences: {
    text: string; translation: string;
    start: number; end: number;  // seconds
    words: { text: string; start: number; end: number }[];
  }[];
};
```

### Voice

```ts
interface TtsProvider {
  id: string; // 'kokoro'
  synthesize(text: string, voice: string): Promise<{
    mp3: Buffer;
    words: { text: string; start: number; end: number }[];
  }>;
}
```

Kokoro adapter: TypeScript calls a small Python script (the `kokoro` library, word timings taken from it in the standard way); ffmpeg converts WAV to mp3. That script is the only Python in the project.

### Translation

```ts
interface Translator {
  id: string; // 'openrouter'
  translate(fullText: string, sentences: string[]): Promise<string[]>;
}
```

OpenRouter adapter: one request per text (the whole text plus numbered sentences), JSON answer. Check: exactly one non-empty translation per sentence. On failure: retry, then the fallback model.

### Settings (GitHub Actions variables)

- `TTS_PROVIDER=kokoro`, `TTS_VOICE=<voice>`
- `TRANSLATOR=openrouter`, `TRANSLATION_MODELS=google/gemma-4-31b-it:free,qwen/qwen3.8-27b:free`

Secrets: `NETLIFY_AUTH_TOKEN`, `NETLIFY_SITE_ID`, `OPENROUTER_API_KEY`. They are entered only in GitHub and Netlify settings, never in the repository.

### Contract tests

Every adapter passes the same tests:

- word timings go up and stay within the audio length;
- every word of the text is matched to a word from the voice output;
- there is exactly one non-empty translation per sentence.

## Repository layout

```text
english-reader/
  shared/              data contract (TextDoc type)
  pipeline/            text processing (Node + TypeScript)
    core/              sentences and words, JSON assembly, checks
    tts/               TtsProvider + kokoro.ts
    translate/         Translator + openrouter.ts
    python/            kokoro_tts.py, the only Python
    tests/             adapter contract tests
  web/                 pages (Vite + TypeScript, no framework)
  netlify/functions/   API: list, text, audio, create, delete, edit
  .github/workflows/   process-text.yml
  netlify.toml
```

## Stages

Each stage ends with a result that can be checked. Each stage is one branch and one pull request.

### Stage 0. Setup (done)

- Branch `setup/skeleton`: `.gitignore`, `.gitattributes`, `.nvmrc` (Node 24), `package.json` with `test` and `typecheck` scripts, `tsconfig.json` (strict), `vitest.config.ts`, TypeScript and Vitest as dev dependencies, `netlify.toml` (publishes `web/`), a placeholder `web/index.html`.
- The repository is connected to Netlify (legacy free plan). Production deploys come only from `main`; branch deploys are off, deploy previews are on.
- **Done:** the placeholder opens at https://simple-english-reader.netlify.app/.

### Stage 1. Voice check

The riskiest part goes first: exact word highlighting with Kokoro timings.

- Kokoro adapter: Python script with word timings, mp3 through ffmpeg.
- A manually started GitHub Actions workflow voices one sample passage with every English Kokoro voice (American and British).
- It builds a listening page: play each voice with the current word highlighted. The page is downloaded from the run page.
- The chosen voice goes into `TTS_VOICE`. The listening page and its workflow are then removed.
- **Done when:** the highlight matches the voice by ear, and a voice is chosen. If it does not match, the approach is changed before stage 2.

### Stage 2. Working site

Everything except the admin. A new text is added by starting a workflow by hand.

- Data contract in `shared/`.
- Sentence and word splitting with `Intl.Segmenter`; matching Kokoro words to text words (punctuation, numbers, apostrophes).
- OpenRouter adapter with answer checks and a fallback model; both free models compared on the same 3 texts.
- Contract tests for both adapters.
- Workflow `process-text`: takes a text, voices and translates it, writes JSON and mp3 with a status to Netlify Blobs. On failure: status `error` with a clear message. Package and model cache.
- Read functions: `GET /api/texts`, `GET /api/texts/:id`, `GET /api/audio/:id`.
- Home page: the list of texts. Text page: whole text with word highlight, one sentence, a word on click (a slice of the full recording with 30–50 ms padding), sentence translation on a button. Playback through the Web Audio API.
- Simple, clean design, checked on phone and desktop.
- **Done when:** 3 real texts, including the longest one, are added through the workflow and work on the site on a phone; tests pass; processing time is measured.

### Stage 3. Admin and launch

- Netlify Identity: invite-only registration.
- `/admin`: login, the "Title, Text, Create" form, the list of texts with status.
- `POST /api/texts`: checks the login, saves the text with status `processing`, starts the workflow through the GitHub API.
- A "Retry" button for status `error`.
- Delete: `DELETE /api/texts/:id` removes the JSON and the mp3; confirmation in the admin page.
- Edit: a new title is saved at once; a changed text is saved and processed again.
- Text length limit in the form, based on measurements.
- Check the fallback translation model by turning off the main one.
- README: where the settings are and how to plug in a new service.
- **Done when:** from a phone, the admin logs in, pastes a text, and the page is ready a few minutes later; then a week of normal use passes with no manual fixes.

## Open questions

- **Translation model:** in stage 2, compare both free models on the same 3 texts. Free OpenRouter models are sometimes removed without notice.
- **Repository visibility:** public for now.

Deferred: a separate "dictionary" voice for single words (a new `TtsProvider` method); DeepL as a fallback translator (one more `Translator` adapter).

## Facts and limits

- **Netlify:** accounts created after 2025-09-04 use credits: 300 free credits a month, a hard limit; a production deploy costs 15 credits, bandwidth 20 credits per GB, requests 2 per 10,000. When credits run out, sites pause until next month. Branch previews are free. Accounts created earlier stay on the legacy free plan; check which plan the account is on and do not switch to credits without a reason. This project's account is on the legacy free plan (100 GB bandwidth and 300 build minutes a month, hard limits), so credits do not apply.
- **Netlify Identity:** announced as deprecated in February 2025, now listed in the docs as a normal feature of all plans. Git Gateway is deprecated (not needed here).
- **OpenRouter:** free models allow 20 requests a minute and 50 a day (1,000 a day after buying $10+ of credits). Each free model has a single host, with no fallback inside OpenRouter. Some free hosts may keep or train on prompts; texts here are not private.
- **GitHub Actions:** standard runners are free for public repositories.
- **Kokoro-82M:** Apache 2.0 weights; word timings for English voices only. The model downloads from Hugging Face.
