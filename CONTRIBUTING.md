# Contributing

## Set-up

```sh
npm install
npx playwright install chromium   # once
npm test                          # phone and desktop, web app and artifact
npm run serve                     # the web app on http://localhost:8080
```

Node 22 and Python 3 are needed. There is no build step for the web app: `docs/` is served as it is.

## Where things live

| Path | What it is |
| --- | --- |
| `docs/index.html`, `docs/styles.css` | Markup and styles, shared by both versions |
| `docs/app.js` | The app. It does not know which backend it runs on |
| `docs/backend-api.js` | Web backend: the Claude API with the user's key |
| `artifact/backend.js` | Artifact backend: the viewer's Claude account (`sample`) and `downloads` |
| `docs/prompts/sapphire/` | The prompt system: `core.txt`, one file per model pack, `critic.txt` |
| `artifact/build.py` | Assembles `artifact/ruvet.html` from the files above |
| `tests/` | Playwright tests; `helpers.js` mocks Claude for both backends |
| `tools/` | Screenshot generator and the SDK bundle entry |

## Rules

- **After changing anything in `docs/`, run `npm run build:artifact`** and commit `artifact/ruvet.html`. CI fails if it is out of date.
- **After changing a prompt part, bump `CACHE` in `docs/sw.js`** so installed copies pick it up.
- **A prompt change needs numbers.** Run the Test view with the same ideas and models before and after, and put both tables in the pull request. Lint findings and critic verdicts are the signal; length alone is not.
- Add a test for each new behaviour. Anything that reads outside data (Claude's replies, files, storage, imports) also gets a case in `tests/stress.spec.js`; the mocked Claude in `tests/helpers.js` takes an `override` that returns errors, refusals, delays or hostile text. Tests never call the real Claude API; extend `reply()` in `tests/helpers.js` instead.
- Keep `docs/prompts/sapphire/` in English. The interface text is English too.

## Adding a model

1. Add it to `TARGETS` in `docs/app.js` with its `build` and `pack`.
2. If it needs a new family, add a pack file under `docs/prompts/sapphire/` and a `BUILDS` entry. Otherwise add a line to the right pack's notes.
3. Add any model-specific lint rule to `lint()` and a case to `tests/lint.spec.js`.

## Screenshots

`npm run screenshots` regenerates `screenshots/` from the artifact build with a mocked Claude.
