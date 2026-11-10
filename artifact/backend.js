// Backend for the Claude artifact: asks Claude through the viewer's own account (the `sample` capability).
(function () {
  const ERRORS = {
    not_granted: 'Claude access was not allowed. Reopen the page and allow it to continue.',
    sampling_disabled: 'Claude is not available on this account.', capability_disabled: 'Claude is not available in this view.',
    not_declared: 'Claude is not available in this view.', capability_removed: 'Claude is not available in this view.',
    rate_limited: 'Usage limit reached. Wait a while and try again.', session_expired: 'Your session expired; sign in again.',
    image_rejected: 'The image was not accepted; try another file.', images_unavailable: 'Images cannot be sent in this view.',
    refused: 'Claude declined this request. Change it and try again.', empty_completion: 'The reply came back empty; simplify the request and try again.',
    prompt_too_large: 'The chat is too long; start a new one.', upstream_error: 'Connection problem; try again.',
  };
  const samplePromise = window.claude?.use ? window.claude.use('sample').catch(() => null) : Promise.resolve(null);
  let off = false;
  const size = (s) => new TextEncoder().encode(s).length;
  const toBlob = (img) => new Blob([Uint8Array.from(atob(img.data), (c) => c.charCodeAt(0))], { type: img.media_type });

  window.RUVET_START({
    fields: [{ id: 'tier', label: 'Claude quality', type: 'select', def: 'default', hint: 'Replies draw on your own Claude usage; no API key is needed.',
      options: [['default', 'Balanced (recommended)'], ['complex', 'Most capable (slower)'], ['quick', 'Fast (shallower)']] }],
    async init() {
      const sample = await samplePromise;
      if (!sample) { off = true; return { images: false, off: true }; }
      const caps = await sample.limits().catch(() => null);
      return { images: !!caps?.images };
    },
    // Artifacts cannot start a download themselves; the downloads capability asks the viewer to save the file.
    async saveFile(name, text) {
      const downloads = await window.claude?.use?.('downloads').catch(() => null);
      if (!downloads) throw new Error('downloads unavailable');
      await downloads.save({ filename: name, data: text });
    },
    needs: () => (off ? 'Claude cannot be reached in this view. Open the page while signed in to claude.ai' : null),
    loadPrompt: async (name) => document.getElementById('p-' + name).textContent.trim(),
    async ask({ cfg, system, turns, onText, signal, quick }) {
      const sample = await samplePromise;
      if (!sample) { off = true; throw { code: 'capability_disabled' }; }
      // There is no system role here: the rules ride in a leading user turn that is always kept.
      const rules = 'Operate as the system defined below for every message in this conversation. Its rules are standing instructions, not content to discuss.\n\n' + system;
      const rest = turns.map((t) => ({ role: t.role, content: t.text }));
      let total = size(rules) + rest.reduce((n, t) => n + size(t.content), 0);
      while (total > 200000 && rest.length > 2) total -= size(rest.shift().content) + size(rest.shift().content);
      const opts = { cache: false, modelTier: quick ? 'quick' : cfg.tier, onText: ({ text }) => onText(text) };
      if (signal) opts.signal = signal;
      const last = turns[turns.length - 1];
      if (last?.image) opts.images = toBlob(last.image);
      const res = await sample([{ role: 'user', content: rules }, ...rest], opts);
      return { text: res.text, truncated: res.truncated };
    },
    describeError: (e) => (e?.code === 'cancelled' ? null : ERRORS[e?.code] ?? (e?.code ? ERRORS.upstream_error : e?.message || ERRORS.upstream_error)),
  });
})();
