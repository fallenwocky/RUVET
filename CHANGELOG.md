# Changelog

## Unreleased

### Fixed (found by the stress suite)
- An empty reply from Claude left the web app showing "Thinking…" forever; the run now ends and the text goes back to the composer.
- A double tap on Send cancelled the run it had just started (the button doubles as Stop); taps within 0.8 s of starting are ignored.
- A damaged or hand-edited backup file broke every view; backups, imports and everything read from browser storage are now validated field by field, and unreadable chats are skipped and counted.
- On a phone held sideways, opening the options pushed the Send button off the screen; short screens now keep the input row pinned.

- Attaching images on phones: decoding no longer depends on `createImageBitmap` alone (it falls back to an image element, and to sending a small original when re-encoding runs out of memory); HEIC photos the browser cannot read get instructions; file inputs are no longer `display:none`, which some mobile web views refuse to open.
- In a Claude view that cannot take images, the image button now explains why instead of disappearing, and prompts embedded in PNGs are still read.
- The image button and *Review render* are now labels for their file inputs, so the browser opens the picker itself; some app web views ignore a scripted click. Where no picker opens at all (reported in the Claude Android app), a touch screen gets a hint to open RUVET in the phone's browser or the web app.
- Typing a note in the render-feedback form right after tapping an issue could lose the note.

### Docs
- README: a *Which version?* table comparing the Claude artifact and the web app (who pays, set-up, sharing, model choice, images on a phone, home-screen install), and how to open or run each. Settings now names the version in use. An *On a phone* section explains how to put either version on the home screen.

### Tests
- `tests/images.spec.js`: image attach and render review without `createImageBitmap` or with it failing, a canvas that cannot re-encode, HEIC, and a Claude view without image support.
- `tests/stress.spec.js`: hostile markup in every place Claude's text or user text is shown, empty and malformed replies, API errors, refusals and cut-off replies, a double tap, stopping a slow reply, switching views mid-run, stopping the test bench, 40 runs in one chat, a 1500-prompt library, a 200 KB idea with pathological markdown, corrupt and oversized PNGs, a hostile backup with a `__proto__` key, junk library imports, blocked localStorage and IndexedDB, 320×568 / 568×320 / 2560×1440 screens, and CJK / RTL / emoji text.

## 1.0.0 — 2026-11-11

First release of RUVET. as its own repository (it started as an app inside DSS-Framework).

### The pipeline
- Compile → lint → critic → fix on every request, shown as a stepper on each result.
- Up to four target models per idea, each with its own result tab and conversation branch: Tsubaki.3, Flux, Qwen-Image, GPT-image, Midjourney, Illustrious, NoobAI, Pony V6, Anima, Anima Aesthetic.
- Modes: auto, generate, variants, audit, repair, image, discuss; compact output.

### Writing for the selected model
- One prompt core with one pack per model family, assembled per request.
- Per-model notes for the natural-language targets (negative field or not, Midjourney parameters, text rendering).
- An economy rule in the prompts and the critic: every term must change the picture, each thing is said once, one value per structural field.
- A weak → strong example in each pack.

### Lint (local, no Claude call)
- Dialect: budgets, weights, base and rating or safety tags per model, underscores, parentheses, Midjourney parameters, negatives on models without a negative field, LoRA base model and trigger words.
- Bloat: repeated tags or words, duplicate framing / angle / gaze / palette, quality piles, narration, words with nothing to draw.
- *Fix these findings* for a deletion-only correction; *check locally* for a free check of a pasted prompt.

### Learning
- Worked / Failed marks and *Review render*, where Claude compares the rendered image with the prompt and records the verdict; *Repair with this render*.
- Per-model lessons, house style (typed or inferred from the library) and a cross-chat diversity ledger.

### Everyday tools
- Library with search, remix, JSON export and import.
- Kit for recurring characters and LoRAs.
- Prompts read out of A1111, Forge and ComfyUI PNGs.
- Backup and restore of chats, library, kit and memory as one file.
- Spark: five concept seeds from a theme. Lens, tension and boldness controls.
- Test view: runs a fixed idea set and tabulates length, findings, verdicts, risk and tokens per prompt version.

### Two versions, one codebase
- `docs/`: installable web app (PWA) using the user's Anthropic API key.
- `artifact/ruvet.html`: single-file Claude artifact using the viewer's own Claude account.

### Repository
- Playwright tests for both versions on phone and desktop, with a mocked Claude; GitHub Actions CI; README screenshots generated by `npm run screenshots`.
