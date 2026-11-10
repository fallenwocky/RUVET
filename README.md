# RUVET.

RUVET. is a prompt pipeline for anime and illustration image models. Give it an idea, an image, a rough prompt or a failed render, pick the image models you use, and it returns a prompt written in each model's own dialect — then lints it, has a second pass audit it, applies the fix, and remembers how your renders turned out. It runs the SAPPHIRE Vision Architect v15 prompt system on Claude.

It works on phones and on desktop: on a wide screen the chat history is a permanent sidebar and Enter sends (Shift+Enter makes a new line).

## The pipeline

Every request runs through these stages, shown as a stepper on each result:

1. **Compile** — SAPPHIRE stages the scene (framing, hands, support, light), scores its structural risk, and writes the positive and negative prompts in the target model's syntax.
2. **Lint** — deterministic checks in the browser, no model call, in two groups. *Dialect*: the target model's own syntax — tag or word budget, weight limits, base and rating or safety tags per model, underscores and unescaped parentheses, description models fed tag strings, negatives that contradict the positive. *Bloat*: repeated tags or words, more than one framing, angle, gaze or palette, quality piles, narration ("the image shows"), and adjectives with nothing to draw. Each result shows a *dialect* and a *lean* pill, and *Fix these findings* sends exactly the findings back for a deletion-only correction.
3. **Critic** — a second, independent pass audits the output against the rules and returns PASS, FIX or REJECT.
4. **Fix** — on FIX, the critic's corrected blocks become the final prompt; the original report stays available underneath.
5. **Review** — after you render, give the image back with *Review render*. Claude looks at it next to the prompt, says what broke and what held up, and offers *Repair with this render*, which sends the image and the diagnosis through repair mode.
6. **Learn** — every review (or a manual *Worked* / *Failed* mark) is kept per model and used in later chats.

## Lean by rule

Most AI-written prompts are long because length looks like effort. RUVET.'s prompts carry an economy rule instead: every term must change the picture, each thing is said once, each structural field gets one value, and a tag budget is a ceiling rather than a target. The compiler applies it, the critic audits it (its fix for padding is deletion, never rewording), and the lint measures it.

## What it does

- **Several models from one idea.** Pick up to four targets (Tsubaki.3, Flux, Qwen-Image, GPT-image, Midjourney, Illustrious, NoobAI, Pony V6, Anima, Anima Aesthetic). Each gets its own compile and audit, shown as tabs, and each keeps its own conversation branch for follow-ups.
- **Memory that carries across chats.** Per-model lessons (condensed from your render results on request, and editable), your house style (typed in, or inferred from the prompts you saved), and a diversity ledger so new chats do not repeat the lens, light, palette and staging of the last ones.
- **Kit.** Save the characters you reuse (identity, outfit, notes) and your LoRAs (trigger words, weight, type, base model), then pick them per request. Lint flags a LoRA whose base does not run on the target model, a missing trigger and an over-weighted style LoRA.
- **Reads prompts out of PNGs.** Attach a PNG from A1111, Forge or ComfyUI and the embedded prompt and settings are read on the device and placed in the composer, ready to audit or repair.
- **Backup.** One file holds chats, library, kit and memory (never the API key) and restores them on any device.
- **Creative direction.** Force a lens (before, after, detail, environment, metaphor…) or a tension type, set boldness from safe to bold, or use *Spark* to get five concept seeds from a theme.
- **Modes:** auto · generate · variants · audit · repair · image · discuss, plus compact output.
- **Library.** Keep prompts, search and filter them, remix one into variants, export or import as JSON.
- Image input (pick a file, or paste one on desktop). Everything is stored on the device.

### How this differs from similar tools

Prompt upsamplers such as [TIPO / DanTagGen](https://github.com/KohakuBlueleaf/z-tipo-extension) and [sd-danbooru-tags-upsampler](https://www.github.com/p1atdev/sd-danbooru-tags-upsampler) expand a prompt with a small local model, and tag builders such as [danbooru-diffusion-prompt-builder](https://repos.ecosyste.ms/hosts/GitHub/repositories/wfjsw%2Fdanbooru-diffusion-prompt-builder) help you pick tags by hand. RUVET. is a different kind of tool: it plans the picture before writing it (one moment, one light source, a state for every visible hand), scores how likely the render is to break, audits and corrects its own output, writes the same idea for tag, hybrid and description models, and adjusts to your reported render results. It needs Claude to do so, and it does not generate images.

## Two versions, one codebase

### Web app (`docs/`)

A static, installable web app (PWA) with no build step. It calls the Claude API directly from the browser, so you enter your own Anthropic API key in Settings; the key is kept only on your device (`localStorage`).

1. **Publish:** on GitHub, open this repository's *Settings → Pages*, choose *Deploy from a branch*, and select `main` and the `/docs` folder.
2. **Install on a phone:** open the page → Android/Chrome: *Add to Home screen* · iOS/Safari: *Share → Add to Home Screen*.
3. **Try locally:** `npm run serve` → http://localhost:8080

### Keyless version (`artifact/`)

`artifact/ruvet.html` is the same app as a single file, published as an artifact on claude.ai. It needs no API key; replies draw on the Claude usage of whoever opens the page. Instead of a Claude model you choose a quality tier, and there is no UNIVERSAL build option.

It is assembled from the web app's own files: `python3 artifact/build.py` takes the markup, `styles.css`, `app.js` and the prompts from `docs/`, and swaps `docs/backend-api.js` for `artifact/backend.js`. After any change, rebuild and republish the artifact.

## Development

- `docs/app.js` — the app; backend-agnostic. `docs/backend-api.js` (Claude API) and `artifact/backend.js` (Claude artifact) are the two backends.
- `docs/prompts/` — the SAPPHIRE builds and the CRITIC prompt. If you change them, bump the `CACHE` version in `docs/sw.js`.
- `docs/vendor/anthropic.js` — browser bundle of the official `@anthropic-ai/sdk`; update with `npm install && npm run build:vendor`.

A full pipeline run costs two Claude calls per target model (compile and critic). Turn off *critic + auto-fix* in the options to make it one.

## License

MIT
