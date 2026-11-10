# RUVET.

RUVET. is a prompt compiler for anime and illustration image models. Give it an idea, an image, a rough prompt or a failed render, pick the target model, and it returns a prompt written in that model's own dialect, with a risk report and a matching negative prompt. It runs the SAPPHIRE Vision Architect v15 prompt system on Claude.

The app works on phones and on desktop: on a wide screen the chat history becomes a permanent sidebar and Enter sends the message (Shift+Enter makes a new line).

## Features

- **Modes:** auto · generate · variants · audit · repair · image · discuss, plus a compact-output toggle
- **Target models:** Tsubaki.3, Flux, Qwen-Image, GPT-image, Midjourney, Illustrious, NoobAI, Pony V6, Anima, Anima Aesthetic — the matching prompt build (TSUBAKI / TAG / ANIMA) is loaded automatically
- **Critic pass:** any output can be sent through the SAPPHIRE CRITIC prompt with one click
- Image input (pick a file, or paste one on desktop), house style, chat history stored on the device, copy buttons for the Positive / Negative blocks

## Two versions

### Web app (`docs/`)

A static, installable web app (PWA) with no build step. It calls the Claude API directly from the browser, so you enter your own Anthropic API key in Settings; the key is kept only on your device (`localStorage`).

1. **Publish:** on GitHub, open this repository's *Settings → Pages*, choose *Deploy from a branch*, and select `main` and the `/docs` folder.
2. **Install on a phone:** open the page → Android/Chrome: *Add to Home screen* · iOS/Safari: *Share → Add to Home Screen*.
3. **Try locally:** `npm run serve` → http://localhost:8080

### Keyless version (`artifact/`)

`artifact/ruvet.html` is a single-file version published as an artifact on claude.ai. It needs no API key; replies draw on the Claude usage of whoever opens the page. Differences from the web app: there is no UNIVERSAL build option, and instead of a Claude model you choose a quality tier (balanced / most capable / fast).

The file is generated from `artifact/template.html` and the prompts under `docs/prompts/`: `python3 artifact/build.py`. After changing the prompts or the template, regenerate it and republish the artifact.

## Development

`docs/` is plain HTML/CSS/JS. `docs/vendor/anthropic.js` is the browser bundle of the official `@anthropic-ai/sdk` package; to update it run `npm install && npm run build:vendor`. The prompts live under `docs/prompts/`; if you change them, bump the `CACHE` version in `docs/sw.js`.

## License

MIT
