# Project rules

Read [docs/PLAN.md](docs/PLAN.md) before any work. It holds the architecture, the data contract and the stages.

## Git

- Each stage is a separate branch and a pull request.
- Never push to `main` directly. A human reviews and merges every pull request.
- Never commit secrets: API keys and tokens live only in GitHub and Netlify settings.

## Code

- TypeScript, Node 24.
- Comments in plain, simple English: short but clear.
- Each file starts with 1–2 lines: what it holds and why it exists.
- Every function and interface has a JSDoc comment: what it does, what it takes, what it returns.
- Inside code, comments explain "why", not the obvious "what".
- Test names describe behaviour, for example `returns one translation per sentence`.

## Dependencies and technology

- Keep dependencies to a minimum. Justify each new one and ask before adding it.
- Use only mature, widely used, actively maintained technology.
- No unofficial APIs and no tricks to get around free-tier rules.
- Check prices, limits and service status against current sources, not memory, and cite them.

## Scope

- Build only what the plan describes. Do not add features that were not asked for.
