# english-reader

A small site for learning English by reading and listening: https://simple-english-reader.netlify.app

Paste a short English text into the admin page, and a few minutes later the site has a page for it:

- the whole text read aloud by a natural voice, with the current word highlighted (pause and continue);
- one sentence per line; tap a sentence to play it or to see its translation;
- each sentence is translated with the whole text as context.

The architecture, the data contract and the stages are in [docs/PLAN.md](docs/PLAN.md).

## How a text is made

1. The admin logs in at `/admin/login` and adds a text at `/admin/new`: a title, a text (up to 5,000 characters), a voice and a translation model. The voices and models to choose from are listed in `shared/voices.ts` and `shared/translation-models.ts`.
2. A Netlify function saves the text in Netlify Blobs with status `processing` and starts the `process-text` workflow on GitHub Actions with the text id.
3. The workflow voices the text with Kokoro, translates it with OpenRouter, and saves the result (JSON and mp3) with status `ready`, or status `error` with the reason. The text's admin page (`/admin/texts/<id>`) shows the status as it changes.

Lists of texts (the home page and `/admin`) are read from one stored index of all texts, which every writer updates safely.

## Settings

Secrets live only in these settings, never in the repository.

| Where | Name | What it is |
|---|---|---|
| GitHub → Settings → Secrets and variables → Actions → **Secrets** | `OPENROUTER_API_KEY` | OpenRouter API key, for translation |
| same, **Secrets** | `NETLIFY_AUTH_TOKEN` | Netlify personal access token, so the workflow can write to Netlify Blobs. It can reach the whole Netlify account. |
| same, **Variables** | `NETLIFY_SITE_ID` | Netlify project ID (not a secret) |
| Netlify → Project configuration → Environment variables | `GITHUB_TOKEN` | GitHub fine-grained token for this repository only, with "Actions: Read and write", so the admin page can start the workflow |
| Netlify → Identity | | Login for `/admin`. Registration is "Invite only"; only the admin is invited. |
| OpenRouter → Settings → Privacy | | "Allow free endpoints that train on request data" must be on, or free models refuse requests |

### When a token expires

- **`GITHUB_TOKEN`** (in Netlify): new texts end with the error "Не удалось запустить обработку: GitHub answered 401". Create a new fine-grained token (GitHub → Settings → Developer settings → Fine-grained tokens; this repository only; Actions: Read and write) and replace the value in Netlify.
- **`NETLIFY_AUTH_TOKEN`** (in GitHub): texts stay `processing` and the workflow run fails. Create a new token in Netlify (User settings → Applications → Personal access tokens) and replace the secret in GitHub.

## Replacing a service

Each outside service is behind one file:

| Service | Where | To replace it |
|---|---|---|
| Voice (Kokoro) | `pipeline/tts/` | Write an adapter that implements `TtsProvider`, add it to `pipeline/tts/providers.ts`, add its voices to `shared/voices.ts`. Old texts keep their voice. |
| Translation (OpenRouter) | `pipeline/translate/` | Write an adapter that implements `Translator`, add it to `pipeline/translate/translators.ts`, add its models to `shared/translation-models.ts`. |
| Login (Netlify Identity) | `netlify/lib/auth.ts` (server), `web/src/admin.ts` (login form) | Change these two files. |
| Starting a run (GitHub Actions) | `netlify/lib/trigger.ts` | Change this file. |
| Storage (Netlify Blobs) | `shared/storage.ts`, `shared/text-index.ts`, `pipeline/store.ts`, `netlify/lib/texts.ts`, the read functions in `netlify/functions/` | Change the store access in these files; the data format stays. |

Every adapter must pass the contract tests in `pipeline/tests/`.

## Development

Node 24 (see `.nvmrc`).

```bash
npm install
npm test            # unit and contract tests
npm run typecheck   # TypeScript, strict
npm run dev         # pages on http://localhost:5173; /api goes to the live site (API_ORIGIN changes it)
npm run build       # pages into web/dist
```

Kokoro runs only in GitHub Actions. Every pull request that touches `pipeline/` gets a dry run of the whole pipeline on `pipeline/samples/sample.txt`; its JSON and mp3 are in the run's `dry-run` artifact. Netlify builds a deploy preview of every pull request.
