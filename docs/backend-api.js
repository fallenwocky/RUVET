// Backend for the web app: calls the Claude API from the browser with the user's own key.
import Anthropic from './vendor/anthropic.js';

// Models that accept the server-side refusal fallback.
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-2']);
const prompts = new Map();

window.RUVET_START({
  fields: [
    { id: 'apiKey', label: 'Anthropic API key', type: 'password', placeholder: 'sk-ant-…', hint: 'Stored only on this device and sent directly to api.anthropic.com. Get a key at console.anthropic.com' },
    { id: 'model', label: 'Claude model', type: 'select', def: 'claude-opus-5-5', options: [
      ['claude-opus-5-5', 'Claude Opus 5.5 (recommended)'], ['claude-sonnet-5-5', 'Claude Sonnet 5.5 (fast, cheaper)'],
      ['claude-haiku-5-5', 'Claude Haiku 5.5 (cheapest)'], ['claude-fable-5-2', 'Claude Fable 5.2 (most capable)']] },
    { id: 'effort', label: 'Thinking effort', type: 'select', def: 'medium', options: [['low', 'low'], ['medium', 'medium'], ['high', 'high']] },
    { id: 'build', label: 'Prompt build', type: 'select', def: 'auto', options: [['auto', 'Match the target model (fewer tokens)'], ['universal', 'UNIVERSAL (all packs)']] },
  ],
  init: () => ({ images: true }),
  async saveFile(name, text) {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: name });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  },
  needs: (cfg) => (cfg.apiKey ? null : 'Enter your Anthropic API key in Settings to start'),
  async loadPrompt(name) {
    if (!prompts.has(name)) {
      const r = await fetch(`prompts/SAPPHIRE_v15_${name}.txt`);
      if (!r.ok) throw new Error(`Could not load the prompt file: ${name}`);
      prompts.set(name, await r.text());
    }
    return prompts.get(name);
  },
  async ask({ cfg, system, turns, onText, signal, quick }) {
    const client = new Anthropic({ apiKey: cfg.apiKey, dangerouslyAllowBrowser: true });
    const messages = turns.map((t) => {
      if (t.role === 'assistant') return { role: 'assistant', content: t.raw ?? t.text };
      const content = [];
      if (t.image) content.push({ type: 'image', source: { type: 'base64', media_type: t.image.media_type, data: t.image.data } });
      content.push({ type: 'text', text: t.text });
      return { role: 'user', content };
    });
    const params = {
      model: cfg.model,
      max_tokens: quick ? 8000 : 32000,
      thinking: { type: 'adaptive' },
      output_config: { effort: quick ? 'low' : cfg.effort },
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages,
    };
    const stream = FALLBACK_MODELS.has(cfg.model)
      ? client.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
      : client.messages.stream(params);
    const abort = () => stream.abort();
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    stream.on('text', (_delta, snapshot) => onText(snapshot));
    try {
      const msg = await stream.finalMessage();
      return {
        text: msg.content.filter((b) => b.type === 'text').map((b) => b.text).join(''),
        raw: msg.content,
        truncated: msg.stop_reason === 'max_tokens',
        refused: msg.stop_reason === 'refusal',
      };
    } finally { signal?.removeEventListener('abort', abort); }
  },
  // null means the user cancelled; anything else is a message to show.
  describeError(e) {
    if (e instanceof Anthropic.APIUserAbortError) return null;
    if (e instanceof Anthropic.AuthenticationError) return 'Invalid API key. Check it in Settings.';
    if (e instanceof Anthropic.PermissionDeniedError) return 'This key has no access to the selected model. Try another model in Settings.';
    if (e instanceof Anthropic.NotFoundError) return 'Model not found. Pick another model in Settings.';
    if (e instanceof Anthropic.RateLimitError) return 'Rate limit reached. Wait a moment and try again.';
    if (e instanceof Anthropic.APIConnectionError) return 'Could not connect. Check your internet connection.';
    if (e instanceof Anthropic.APIError) return `API error${e.status ? ` (${e.status})` : ''}: ${e.message}`;
    return e?.message || 'Unknown error';
  },
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
