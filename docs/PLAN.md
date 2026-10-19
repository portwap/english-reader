# Plan

Facts about services are as of 2026-10-11. Re-check them before relying on them.

## What the site does

1. **Home page:** a list of texts with links to their pages.
2. **Admin page `/admin`:** login with email and password (one admin only), a form "Title, Text, Create", a list of texts with their status, delete and edit.
3. **Processing:** after a text is created, the site voices and translates it on its own, then the text page appears.
4. **Text page:**
   - play the whole text; the word being spoken is highlighted, exactly in sync with the voice;
   - one sentence per line; tap a sentence to select it, then play it;
   - show the Russian translation of a sentence with a button next to it. Each sentence is translated with the whole text as context. No whole-text translation.
5. **Design:** simple, clean, easy to read, works on phone and desktop.
6. **Out of scope:** speed controls (normal natural speed only), dictionaries, flashcards, other users.

Volume: 1–2 texts a day. Typical texts are about 500–2,500 characters (100–400 words); the form limit will be set from these, with a margin.

Budget: free if possible, at most 2–3 € a month.

## Architecture

- **Netlify:** site pages, admin login (Netlify Identity, invite-only, through the official `@netlify/identity` library), storage (Netlify Blobs: texts, translations, timings, mp3), API functions in TypeScript.
- **GitHub Actions:** processing of each text. Kokoro voices it with word timings, OpenRouter translates it. The result is written to Netlify Blobs.
- **OpenRouter:** translation with free models: `nvidia/nemotron-3-super-120b-a12b:free` (default), `google/gemma-4-31b-it:free` (another company, so one outage does not stop both), `nvidia/nemotron-3-ultra-550b-a55b:free`.

The path of one text:

1. The admin logs in at `/admin` and sends a title, a text and a voice.
2. A Netlify function saves the text with status `processing` and starts the GitHub Actions workflow through the GitHub API with the text id. The GitHub token (Actions: write on this repository only) is stored in Netlify settings.
3. The pipeline in Actions reads the text from Netlify Blobs by its id, splits it into sentences and words, voices it with Kokoro (word timings included) and translates the sentences through OpenRouter.
4. JSON and mp3 with status `ready` are written to Netlify Blobs, and the text appears on the home page. No site rebuild is needed.

## Modularity

The site knows only the data format. Voice and translation services plug in through adapters. Swapping a service means adding one adapter file and changing one setting.

### Data contract

```ts
type TextDoc = {
  schemaVersion: 1;
  id: string; title: string; createdAt: string;
  status: 'processing' | 'ready' | 'error'; error?: string;
  source: string;                // the text as pasted, for editing and processing again
  tts: { provider: string; voice: string };
  translation: { provider: string; model: string };
  audio: string;                 // mp3 key in storage; empty until ready
  log?: ProcessEvent[];          // steps of the last run (models tried, failures, times), for the admin page
  sentences: {                   // empty until ready
    text: string; translation: string;
    paragraph: number;           // paragraph number, from 0
    start: number; end: number;  // seconds
    words: { text: string; start: number; end: number; at: number }[]; // at: position in the sentence text
  }[];
};
```

### Voice

```ts
interface TtsProvider {
  id: string; // 'kokoro'
  synthesize(text: string, voice: string): Promise<{
    mp3: Buffer;
    duration: number; // seconds; word timings must fit inside it
    words: { text: string; start: number; end: number }[];
  }>;
}
```

Kokoro adapter: TypeScript calls a small Python script (the `kokoro` library, word timings taken from it in the standard way); ffmpeg converts WAV to mp3. That script is the only Python in the project.

Voices: `af_heart`, `af_sky`, `am_adam`, `am_eric`, `am_liam` (default). The list lives in `shared/voices.ts`; each voice names its provider (`kokoro:am_liam`), and each text keeps the voice it was made with. To add a voice service: write its adapter, add it to `pipeline/tts/providers.ts`, and add its voices to the list.

### Translation

```ts
interface Translator {
  id: string; // 'openrouter'
  translate(fullText: string, sentences: string[]): Promise<{ translations: string[]; model: string }>;
}
```

OpenRouter adapter: one request per text (the whole text plus numbered sentences), JSON answer. Check: exactly one non-empty translation per sentence. The chosen model goes first, then the other models in list order:

- a broken answer, a timeout or a server error: one more try with the same model (on 2026-10-19 a second try after a timeout worked);
- a rate limit (429) or another refusal: the next model at once, since these do not pass in seconds;
- one answer may take up to 5 minutes (a busy free model needed 4.5 minutes for 2,500 characters), the whole translation up to 15.

Each request carries the text id as `session_id`, so OpenRouter's logs group the requests of one text. Every attempt and failure is written to the text's `log` as it happens, and the admin page shows it.

Models were chosen by the [WMT24++ translation ranking](https://llm-stats.com/benchmarks/wmt24++) (checked 2026-10-19): Nemotron 3 Super is first, Nemotron 3 Ultra sixth; no other ranked model is free on OpenRouter. Gemma 4 is not ranked (Gemma 3 27B is 15th); it stays because it runs at another company. Gemma comes before Ultra in the list, so that when NVIDIA is slow, Gemma still gets its turn within the time limit. The ranking covers 55 languages, not English to Russian alone; no ranking of free models for English to Russian was found.

### Settings (GitHub Actions variables)

- The voice is chosen for each text in the admin form; there is no voice setting.
- The translation model is chosen for each text in the admin form, from `shared/translation-models.ts`; the chosen one is tried first, the others of the same service follow as fallbacks. There is no model setting.
- `NETLIFY_SITE_ID`: the Netlify project ID (not a secret).

Secrets: `NETLIFY_AUTH_TOKEN` (a Netlify personal access token with an expiry date; it can reach the whole Netlify account, so it lives only in GitHub secrets), `OPENROUTER_API_KEY`. They are entered only in GitHub and Netlify settings, never in the repository.

### Contract tests

Every adapter passes the same tests:

- word timings go up and stay within the audio length;
- every word of the text is matched to a word from the voice output;
- there is exactly one non-empty translation per sentence.

## Repository layout

```text
english-reader/
  shared/              data contract (TextDoc), storage layout, text index, voices, rules for a new text
  pipeline/            text processing (Node + TypeScript)
    process.ts         command line entry: processes one text (by id, or a dry run from a file)
    mark-failed.ts     marks a text as failed if its workflow run stopped early
    core/              sentences and words, JSON assembly, checks, the processing flow
    samples/           sample text for dry runs
    tts/               TtsProvider, kokoro.ts, providers.ts (adapter by provider id)
    translate/         Translator, openrouter.ts, translators.ts (adapter by the text's translation provider)
    python/            kokoro_tts.py, the only Python
    tests/             adapter contract tests
  web/                 pages (Vite + TypeScript, no framework); web/admin/ and web/src/admin/ hold the admin pages
  netlify/functions/   API: list, text, audio; admin: list, create, read, edit, delete, retry
  netlify/lib/         login check, starting a run, admin storage access
  .github/workflows/   process-text.yml
  netlify.toml
```

## Stages

Each stage ends with a result that can be checked. Each stage is one branch and one pull request.

### Stage 0. Setup (done)

- Branch `setup/skeleton`: `.gitignore`, `.gitattributes`, `.nvmrc` (Node 24), `package.json` with `test` and `typecheck` scripts, `tsconfig.json` (strict), `vitest.config.ts`, TypeScript and Vitest as dev dependencies, `netlify.toml` (publishes `web/`), a placeholder `web/index.html`.
- The repository is connected to Netlify (legacy free plan). Production deploys come only from `main`; branch deploys are off, deploy previews are on.
- **Done:** the placeholder opens at https://simple-english-reader.netlify.app/.

### Stage 1. Voice check (done)

The riskiest part goes first: exact word highlighting with Kokoro timings.

- Kokoro adapter: Python script with word timings, mp3 through ffmpeg. Python packages are all pinned (see `pipeline/python/requirements.txt`).
- A temporary workflow voiced one sample passage (107 words) with all 28 English Kokoro voices and built a listening page with word highlight. It was then removed.
- Result: all 28 voices worked with no timing problems; about 25 s of processing per 35 s of audio on a standard runner.
- Chosen voices: `af_heart`, `af_sky`, `am_adam`, `am_eric`, `am_liam`; default `am_liam`.
- **Done when:** the highlight matches the voice by ear, and a voice is chosen.

### Stage 2. Working site (done)

Everything except the admin. A new text is added by starting a workflow by hand. Two pull requests: 2a processing, 2b site.

**2a. Processing**

- Data contract in `shared/`.
- Sentence and word splitting with `Intl.Segmenter`; matching Kokoro words to text words (punctuation, numbers, apostrophes).
- OpenRouter adapter with answer checks and a fallback model.
- Contract tests for both adapters.
- Workflow `process-text`: takes a title and a text, voices and translates it, writes JSON and mp3 with a status to Netlify Blobs. On failure: status `error` with a clear message. Package and model cache. On pull requests it does a dry run on the sample text and uploads the result instead of writing to storage.
- In stage 2, texts were started with `gh workflow run` and a title and text; since 3a the workflow takes a text id, and texts are added in the admin page. Texts are never committed to the repository.

**2b. Site**

- Read functions: `GET /api/texts`, `GET /api/texts/:id`, `GET /api/audio/:id` (the mp3 is streamed).
- Home page: the ready texts, ten at a time with "Показать ещё". Text page at `/texts/<id>`: one sentence per line, paragraphs separated by a gap. Tapping a sentence selects it. A bottom bar plays the whole text (pause and continue; the paused word stays marked; the page follows the highlighted word) or the selected sentence (with up to 0.15 s of margin, never into the next sentence), and shows the selected sentence's translation. Reading the whole text clears the selection and highlights only the word being spoken. Single words are not played: Kokoro's word boundaries are not exact enough for clean slices. Playback through the Web Audio API at 24 kHz.
- Pages are built with Vite into `web/dist`; in development, `/api` is sent to a deployed site (`API_ORIGIN`).
- Simple, clean design; Android phones first, desktop too.
- **Done when:** 2 real texts are added through the workflow and work on the site on an Android phone; tests pass; processing time is measured (2a: 21–34 s of processing, 2–2.5 min per workflow run).

### Stage 3. Admin and launch

Two pull requests: 3a processing by id, 3b admin.

**3a. Processing by id**

- The workflow takes a text id; the text, title and voice are read from storage. The voice adapter is chosen by the voice's provider.
- Limits: a run stops after 22 minutes (the processing step after 18; the translation alone after 15). If a run fails or is cancelled, a last step sets status `error` so a text never stays `processing`.
- Shared rules for a new text (`shared/new-text.ts`): title up to 200 characters, text up to 5,000 characters (real texts are about 500–2,500), a voice from the list, ids of `a-z0-9-` only.

**3b. Admin**

- Netlify Identity: invite-only registration; any logged-in user is the admin (only one is invited). Login checks live in one file, so the login service can be replaced in one place.
- Admin pages, each with its own address and one task; a top menu "Тексты · Новый текст · На сайт · Выйти":
  - `/admin`: the list of texts, newest first, with search by title, "Показать ещё", and "Показывать по 10 / 20 / 50" (remembered in the browser, 10 by default); each row opens the text's page;
  - `/admin/new` and `/admin/texts/<id>/edit`: the "Title, Text, Voice, Translation" form (voice and model from the allowed lists; the last chosen ones are preselected), with a character counter; a new text, voice or model is processed again;
  - `/admin/texts/<id>`: status (and the error), details, the actions that make sense now (open on the site, edit, retry, delete), and "Ход обработки": every step of the last run with its time; it refreshes itself while the text is processed;
  - `/admin/login` (comes back to the page that was asked for; only admin pages are allowed as the way back), `/admin/forgot` (reset email; the same answer for any address), `/admin/password` (from the invite or reset link, or to change the password when logged in).
- Creating a text: checks the login, saves the text with status `processing`, starts the workflow through the GitHub API (the call to GitHub lives in one file).
- A "Retry" button for status `error`, and for a text still `processing` after 25 minutes.
- Delete: removes the JSON and the mp3; confirmation in the admin page.
- Edit: a new title is saved at once; a changed text or voice is saved and processed again.
- The invite and reset links from the emails open the home page; the home page passes them on to `/admin/password`.
- Admin bar: in a browser where the admin is logged in, the public pages show a thin bar with links to the admin ("Админка", and "Новый текст" or "Этот текст в админке"). It holds only links; the public pages have no edit or delete buttons.
- Text index (`shared/text-index.ts`): one stored list with every text's summary, so lists are read with one request instead of one per text. Every writer (pipeline and admin) changes it with conditional writes and retries, so two writers at once lose nothing; a missing index is rebuilt from the texts. The home page and the admin list show it page by page.
- Security: every admin function checks the login on the server; changing requests must come from the site itself (origin check); input is checked on the server; text is always inserted as text, never as HTML; a Content-Security-Policy allows scripts, styles and requests only from the site; the site cannot be shown inside other sites' frames.
- Check the fallback translation model by turning off the main one.
- README: where the settings are and how to plug in a new service.
- **Done when:** from a phone, the admin logs in, pastes a text, and the page is ready a few minutes later; then a week of normal use passes with no manual fixes.

## Open questions

- **Translation model:** chosen by ranking (see Translation); check the translations of the first texts by reading them. Free OpenRouter models are sometimes removed without notice; the fallback model covers that, and the list in `shared/translation-models.ts` is changed in one place.
- **Repository visibility:** public for now.

Deferred: a separate "dictionary" voice for single words (a new `TtsProvider` method); DeepL as a fallback translator (one more `Translator` adapter).

## Facts and limits

- **Netlify:** accounts created after 2025-09-04 use credits: 300 free credits a month, a hard limit; a production deploy costs 15 credits, bandwidth 20 credits per GB, requests 2 per 10,000. When credits run out, sites pause until next month. Branch previews are free. Accounts created earlier stay on the legacy free plan; check which plan the account is on and do not switch to credits without a reason. This project's account is on the legacy free plan (100 GB bandwidth and 300 build minutes a month, hard limits), so credits do not apply.
- **Netlify Identity:** announced as deprecated in February 2025; the deprecation was reversed in February 2026, and it is supported (docs updated 2026-03-30). Invite-only registration and unlimited users on all plans; on free plans the email templates cannot be customized. No two-factor login. Git Gateway is deprecated (not needed here).
- **OpenRouter:** free models allow 20 requests a minute and 50 a day (1,000 a day after buying $10+ of credits). Each free model has a single host, with no fallback inside OpenRouter. Some free hosts may keep or train on prompts; texts here are not private. A busy free host answers 429 "temporarily rate-limited upstream" to everyone; that is not this account's limit.
- **GitHub Actions:** standard runners are free for public repositories.
- **Kokoro-82M:** Apache 2.0 weights; word timings for English voices only. The model downloads from Hugging Face.
