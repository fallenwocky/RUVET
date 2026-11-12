# Changelog

## Unreleased

### Changed (prompt fidelity, from the first real renders)
- The first real runs dropped things the user had asked for: a courier "eating instant noodles" became a figure seen from behind holding a cup, an audit deleted the sunbeams the prompt asked for and added a stream. The core prompt now treats every element the user states as kept and visible; a risk fix or a banned-effect rule can no longer remove one, a back view has to be earned by the concept, and an audit adds nothing the original did not contain.
- The critic now receives the user's request and checks the prompt against it first (missing, replaced, reduced or hidden elements).
- Not yet measured with the Test view; these rules are judged by the next real runs.

### Fixed (found by the stress suite)
- An empty reply from Claude left the web app showing "Thinking…" forever; the run now ends and the text goes back to the composer.
- A double tap on Send cancelled the run it had just started (the button doubles as Stop); taps within 0.8 s of starting are ignored.
- A damaged or hand-edited backup file broke every view; backups, imports and everything read from browser storage are now validated field by field, and unreadable chats are skipped and counted.
- On a phone held sideways, opening the options pushed the Send button off the screen; short screens now keep the input row pinned.

- Attaching images on phones: decoding no longer depends on `createImageBitmap` alone (it falls back to an image element, and to sending a small original when re-encoding runs out of memory); HEIC photos the browser cannot read get instructions; file inputs are no longer `display:none`, which some mobile web views refuse to open.
- In a Claude view that cannot take images, the image button now explains why instead of disappearing, and prompts embedded in PNGs are still read.
- The image button and *Review render* are now labels for their file inputs, so the browser opens the picker itself; some app web views ignore a scripted click. Where no picker opens at all (reported in the Claude Android app), a touch screen gets a hint to open RUVET in the phone's browser or the web app.
- Typing a note in the render-feedback form right after tapping an issue could lose the note.

- On a phone, *Review render* sat at the end of a long report and was easy to miss; a short row with *Copy prompt* and *Review render* now sits right under the prompt, and the first copy points at the review step once.

### Fixed (deep stress rounds: fuzzing and a line-by-line read)
- **Security:** a crafted backup file could inject script through record ids, image data and other stored fields. Stored results are rebuilt field by field, ids must be plain tokens, image data must be base64, and stored values are escaped where they are written.
- **Security:** text from a render review, a learned lesson, a feedback note or the house style could add lines to, or close, the memory block in the system prompt. It is reduced to one plain line first.
- Three parsers took minutes on crafted input (the critic verdict, a pasted prompt with many blank lines, an A1111 PNG text chunk). All are linear now.
- On desktop, pressing Enter while a run was going cancelled it.
- Clicking the animated step chip of a running result threw an error, and the chip picked up the result card's margins (a shared class name).
- Anima prompts were counted one tag short and one sentence over, so three sentences raised a false warning.
- Marking a result several times left contradictory entries in memory; repairing one model dropped queued feedback for the others; when the first model failed the result opened on its empty tab; a review that could not be read deleted the earlier one.
- A result saved while still streaming came back looking finished; restoring a backup or deleting the open chat during a run corrupted or resurrected it.
- Storage failures were reported on every keystroke, or never for chats; they are reported once.
- Keyboard and screen readers: on a phone the closed history drawer could still be tabbed into; *Review render* could not be reached or pressed from the keyboard; five inputs had no accessible name; the results area announced every streamed repaint. Escape now closes the drawer and focus returns to the menu button.
- A queued repaint could replace a result card just after it finished, dropping focus from a control inside it.
- The artifact said "the chat is too long" when a single message was too long.
- Two tabs on the same chat erased each other's results (the last save won). A save now reads and writes in one transaction and keeps the runs the other tab added; memory, library and kit changes in one tab reach the others instead of being overwritten.
- Lessons that were not text, settings outside their options, and words like "constructor" in the repeated-word count are handled.

### Docs
- README: a *Which version?* table comparing the Claude artifact and the web app (who pays, set-up, sharing, model choice, images on a phone, home-screen install), and how to open or run each. Settings now names the version in use. An *On a phone* section explains how to put either version on the home screen.

### Tests
- `tests/images.spec.js`: image attach and render review without `createImageBitmap` or with it failing, a canvas that cannot re-encode, HEIC, and a Claude view without image support.
- `tests/fuzz.spec.js`: every field of a real backup replaced by markup or a wrong type (551 variations), random markdown checked against a fixed set of allowed elements, 6000 random strings and 15 adversarial ones through the parsers and lint with a time limit, 600 mutated PNGs, and prompt-boundary checks.
- `tests/platform.spec.js`: the installed web app starting and compiling with its own files unreachable, the service worker's file list against the files on disk, an accessible name on every control of every view, keyboard operation, storage that refuses writes, long-session limits, a failing case in the test bench, and the docs checked against the code (npm scripts, paths, model and mode names, screenshots, version).
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
