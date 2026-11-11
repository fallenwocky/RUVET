# RUVET. — notes for Claude sessions

Read CONTRIBUTING.md first; its rules apply. In short:

- `docs/` is the web app; `artifact/ruvet.html` is generated from it by `python3 artifact/build.py`. Rebuild and commit it after any change under `docs/`.
- `npm test` runs Playwright against a mocked Claude for both versions on phone and desktop. Run it before pushing. Never call the real API from tests.
- Prompt parts are in `docs/prompts/sapphire/`; `BUILDS` in `docs/app.js` says which parts each build uses. Bump `CACHE` in `docs/sw.js` when a part changes.
- Prompt changes are judged with the Test view's numbers, not by reading them.
- The published artifact is https://claude.ai/artifact/8VYXKTLoew7FgWtfZMm7ci and declares the `sample` (with images) and `downloads` capabilities.
