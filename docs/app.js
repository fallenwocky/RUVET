import Anthropic from './vendor/anthropic.js';

// ---------- static data ----------
const TARGETS = [
  { id: 'tsubaki3', label: 'Tsubaki.3 (PixAI)', build: 'TSUBAKI' },
  { id: 'flux', label: 'Flux', build: 'TSUBAKI' },
  { id: 'qwen-image', label: 'Qwen-Image', build: 'TSUBAKI' },
  { id: 'gpt-image', label: 'GPT-image', build: 'TSUBAKI' },
  { id: 'midjourney', label: 'Midjourney', build: 'TSUBAKI' },
  { id: 'illustrious', label: 'Illustrious', build: 'TAG' },
  { id: 'noobai', label: 'NoobAI', build: 'TAG' },
  { id: 'pony', label: 'Pony V6', build: 'TAG' },
  { id: 'anima', label: 'Anima', build: 'ANIMA' },
  { id: 'anima_aesthetic', label: 'Anima Aesthetic', build: 'ANIMA' },
];
const MODES = [
  { id: 'auto', label: 'auto', hint: 'Type an idea, a prompt or a problem…' },
  { id: 'üret', label: 'generate', hint: 'Your idea → a finished prompt' },
  { id: 'varyant', label: 'variants', hint: 'Your idea → different readings' },
  { id: 'denetle', label: 'audit', hint: 'Paste the prompt to audit' },
  { id: 'onar', label: 'repair', hint: 'The prompt + what came out broken' },
  { id: 'görsel', label: 'image', hint: 'Attach an image, add a note if you like' },
  { id: 'tartış', label: 'discuss', hint: 'Let\'s discuss the idea…' },
];
const EXAMPLES = [
  { mode: 'üret', text: 'An old repairman fixing a carousel alone in a closed amusement park' },
  { mode: 'varyant', text: 'A witch who missed the last train' },
  { mode: 'tartış', text: 'An underwater library — where does the idea break?' },
];
// Models that accept the server-side refusal fallback.
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-2']);

// ---------- persistence ----------
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const settings = Object.assign(
  { apiKey: '', claudeModel: 'claude-opus-5-5', effort: 'medium', buildMode: 'auto', house: {} },
  store.get('sapphire.settings', {}),
);
const prefs = Object.assign(
  { mode: 'auto', target: 'tsubaki3', rating: 'general', aspect: '', variants: '3', compact: false },
  store.get('sapphire.prefs', {}),
);

let dbp;
function db() {
  dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open('sapphire', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('chats', { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function idb(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction('chats', mode);
    const rq = fn(t.objectStore('chats'));
    t.oncomplete = () => res(rq?.result);
    t.onerror = t.onabort = () => rej(t.error);
  });
}
const saveChat = () => {
  if (!chat.items.length) return;
  chat.updated = Date.now();
  return idb('readwrite', (s) => s.put(chat)).then(renderChats, () => toast('Could not save the chat (storage may be full)'));
};

// ---------- state ----------
const $ = (id) => document.getElementById(id);
const newChat = () => ({ id: crypto.randomUUID(), title: '', updated: Date.now(), items: [] });
let chat = newChat();
let pendingImage = null; // { media_type, data }
let active = null; // running stream
const promptCache = new Map();

// ---------- helpers ----------
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied'); }
  catch { toast('Could not copy — select the text and copy it manually'); }
}

function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_([^_\s][^_]*)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
}
// Small markdown renderer for SAPPHIRE's report format (headings, lists, bold, fenced blocks).
function md(src) {
  const out = [];
  let list = null, para = [], lastHead = '';
  const flushPara = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flushPara(); flushList();
      const code = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i]);
      const cls = /pozitif|positive/i.test(lastHead) ? ' pos' : /negatif|negative/i.test(lastHead) ? ' neg' : '';
      out.push(`<div class="code${cls}"><pre><code>${esc(code.join('\n'))}</code></pre><button class="copy" data-copy>Copy</button></div>`);
      continue;
    }
    let m;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      flushPara(); flushList();
      lastHead = m[2];
      out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`);
    } else if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flushPara(); flushList(); out.push('<hr>');
    } else if ((m = line.match(/^\s*(?:[-*•]|(\d+)[.)])\s+(.*)$/))) {
      flushPara();
      const kind = m[1] ? 'ol' : 'ul';
      if (list !== kind) { flushList(); out.push(`<${kind}>`); list = kind; }
      out.push(`<li>${inline(m[2])}</li>`);
    } else if (!line.trim()) {
      flushPara(); flushList();
    } else {
      flushList();
      if (/^\*\*[^*]+:\*\*/.test(line)) lastHead = line;
      para.push(line);
    }
  }
  flushPara(); flushList();
  return out.join('');
}

// ---------- prompt assembly ----------
const targetInfo = (id) => TARGETS.find((t) => t.id === id) ?? TARGETS[0];
async function loadPrompt(name) {
  if (!promptCache.has(name)) {
    const r = await fetch(`prompts/SAPPHIRE_v15_${name}.txt`);
    if (!r.ok) throw new Error(`Could not load the prompt file: ${name}`);
    promptCache.set(name, await r.text());
  }
  return promptCache.get(name);
}
async function systemFor(target) {
  const build = settings.buildMode === 'universal' ? 'UNIVERSAL' : targetInfo(target).build;
  let text = await loadPrompt(build);
  const hs = Object.entries(settings.house ?? {}).filter(([, v]) => v?.trim());
  if (hs.length) text += `\n<house_style>\n${hs.map(([k, v]) => `${k}: ${v.trim()}`).join('\n')}\n</house_style>\n`;
  return [{ type: 'text', text, cache_control: { type: 'ephemeral' } }];
}
function compose(text, meta, hasImage) {
  const head = [];
  if (meta.mode !== 'auto') head.push(`mode: ${MODES.find((m) => m.id === meta.mode)?.label ?? meta.mode}`);
  head.push(`model: ${meta.target}`, `rating: ${meta.rating}`);
  if (meta.aspect) head.push(`aspect: ${meta.aspect}`);
  if (meta.mode === 'varyant') head.push(`variants: ${meta.variants}`);
  if (meta.compact) head.push('detail: compact');
  if (hasImage) head.push('image: attached to this message');
  return `${head.join('\n')}\n\n${text}`.trim();
}
// History sent to the API: completed turns only, assistant content replayed unchanged.
function apiMessages() {
  const out = [];
  for (const it of chat.items) {
    if (it.x) continue;
    if (it.kind === 'user') {
      const content = [];
      if (it.image) content.push({ type: 'image', source: { type: 'base64', media_type: it.image.media_type, data: it.image.data } });
      content.push({ type: 'text', text: it.composed });
      out.push({ role: 'user', content });
    } else if (it.kind === 'assistant' && it.content) {
      out.push({ role: 'assistant', content: it.content });
    }
  }
  return out;
}

// ---------- Claude call ----------
function describeError(e) {
  if (e instanceof Anthropic.APIUserAbortError) return null;
  if (e instanceof Anthropic.AuthenticationError) return 'Invalid API key. Check it in Settings.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'This key has no access to the selected model. Try another model in Settings.';
  if (e instanceof Anthropic.NotFoundError) return 'Model not found. Pick another model in Settings.';
  if (e instanceof Anthropic.RateLimitError) return 'Rate limit reached. Wait a moment and try again.';
  if (e instanceof Anthropic.APIConnectionError) return 'Could not connect. Check your internet connection.';
  if (e instanceof Anthropic.APIError) return `API error${e.status ? ` (${e.status})` : ''}: ${e.message}`;
  return e?.message || 'Unknown error';
}
async function runClaude({ system, messages, onText }) {
  const client = new Anthropic({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true });
  const params = {
    model: settings.claudeModel,
    max_tokens: 32000,
    thinking: { type: 'adaptive' },
    output_config: { effort: settings.effort },
    system,
    messages,
  };
  const stream = FALLBACK_MODELS.has(settings.claudeModel)
    ? client.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
    : client.messages.stream(params);
  active = stream;
  stream.on('text', (_delta, snapshot) => onText(snapshot));
  try { return await stream.finalMessage(); }
  finally { active = null; }
}
const textOf = (msg) => msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');

// ---------- rendering ----------
const thread = $('thread');
function bubbleHTML(it) {
  if (it.kind === 'user') {
    const m = it.meta;
    const tags = [m.mode !== 'auto' && MODES.find((x) => x.id === m.mode)?.label, targetInfo(m.target).label, m.rating !== 'general' && m.rating, m.aspect, m.compact && 'compact']
      .filter(Boolean).map((t) => `<span>${esc(t)}</span>`).join('');
    return `${it.image ? `<img alt="Attached image" src="data:${it.image.media_type};base64,${it.image.data}">` : ''}`
      + (it.text ? `<div class="bubble">${esc(it.text)}</div>` : '')
      + `<div class="tags">${tags}</div>`;
  }
  const who = it.kind === 'critic' ? 'Critic' : 'RUVET.';
  const body = it.text ? md(it.text) : '<span class="dots"><i></i><i></i><i></i></span>';
  let actions = '';
  if (!it.pending && it.text) {
    actions = `<div class="actions"><button data-act="copy">Copy all</button>${
      it.kind === 'assistant' && it.content ? '<button data-act="critic">Critic pass</button>' : ''}</div>`;
  }
  return `<div class="who">${who}</div><div class="bubble md">${body}</div>${it.note ? `<div class="note">${esc(it.note)}</div>` : ''}${actions}`;
}
function render() {
  if (!chat.items.length) {
    thread.innerHTML = `<div class="empty">
      <svg class="gem" viewBox="0 0 24 24"><path d="M7 3h10l5 6-10 12L2 9z"/><path d="M2 9h20M7 3l5 6 5-6M12 9v12"/></svg>
      <h2>Hi, I\'m RUVET.</h2>
      <p>Give me an idea, an image or a prompt and pick your target model.</p>
      <div class="ex">${EXAMPLES.map((e, i) => `<button data-ex="${i}">${esc(e.text)}<small>${MODES.find((m) => m.id === e.mode).label}</small></button>`).join('')}
      ${settings.apiKey ? '' : '<button class="keywarn" data-act="settings">Enter your Anthropic API key in Settings to start →</button>'}</div>
    </div>`;
    return;
  }
  thread.innerHTML = chat.items.map((it, i) =>
    `<div class="msg ${it.kind}${it.x && it.kind !== 'critic' ? ' x' : ''}" data-i="${i}">${bubbleHTML(it)}</div>`).join('');
  thread.scrollTop = thread.scrollHeight;
}
let raf = 0;
function renderItem(it) {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    const el = thread.querySelector(`[data-i="${chat.items.indexOf(it)}"]`);
    if (!el) return;
    const stick = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 120;
    el.innerHTML = bubbleHTML(it);
    if (stick) thread.scrollTop = thread.scrollHeight;
  });
}
function setBusy(b) {
  document.body.classList.toggle('busy', b);
  $('sendBtn').setAttribute('aria-label', b ? 'Stop' : 'Send');
}

// ---------- actions ----------
async function send() {
  if (active) { active.abort(); return; }
  const input = $('input');
  const text = input.value.trim();
  if (!text && !pendingImage) return;
  if (!settings.apiKey) { openSettings(); toast('Enter your API key first'); return; }

  const meta = { ...prefs };
  const user = { kind: 'user', text, meta, image: pendingImage, composed: compose(text, meta, !!pendingImage) };
  const asst = { kind: 'assistant', text: '', content: null, target: meta.target, pending: true };
  chat.items.push(user, asst);
  chat.title ||= (text || 'Image').slice(0, 60);
  input.value = ''; autosize(); setImage(null);
  render(); setBusy(true);

  try {
    const msg = await runClaude({
      system: await systemFor(meta.target),
      messages: apiMessages(),
      onText: (snap) => { asst.text = snap; renderItem(asst); },
    });
    asst.text = textOf(msg);
    if (msg.stop_reason === 'refusal') {
      user.x = asst.x = true;
      asst.text ||= 'The model declined this request.';
      asst.note = 'Declined — this turn is left out of later requests.';
    } else {
      asst.content = msg.content;
      if (msg.stop_reason === 'max_tokens') asst.note = 'The reply hit the length limit; you can type "continue".';
    }
  } catch (e) {
    const err = describeError(e);
    if (err === null && asst.text) {
      user.x = asst.x = true;
      asst.note = 'Stopped — this turn is left out of later requests.';
    } else {
      // Nothing usable came back: roll the turn back and return the text to the composer.
      chat.items.splice(chat.items.indexOf(user), 2);
      input.value = text; autosize(); setImage(user.image);
      if (err) toast(err);
    }
  }
  asst.pending = false;
  setBusy(false); render(); saveChat();
}

async function runCritic(src) {
  if (active) return;
  if (!settings.apiKey) { openSettings(); return; }
  const item = { kind: 'critic', text: '', pending: true, x: true };
  chat.items.splice(chat.items.indexOf(src) + 1, 0, item);
  render(); setBusy(true);
  thread.querySelector(`[data-i="${chat.items.indexOf(item)}"]`)?.scrollIntoView({ block: 'nearest' });
  try {
    const msg = await runClaude({
      system: [{ type: 'text', text: await loadPrompt('CRITIC') }],
      messages: [{ role: 'user', content: `Target model: ${src.target}\n\n${src.text}` }],
      onText: (snap) => { item.text = snap; renderItem(item); },
    });
    item.text = textOf(msg) || 'The critic returned nothing.';
  } catch (e) {
    const err = describeError(e);
    if (!item.text) chat.items.splice(chat.items.indexOf(item), 1);
    if (err) toast(err);
  }
  item.pending = false;
  const top = thread.scrollTop;
  setBusy(false); render(); thread.scrollTop = top; saveChat();
}

// Downscale to the API's useful maximum and re-encode as JPEG.
async function readImage(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1568 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return { media_type: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.88).split(',')[1] };
}
function setImage(img) {
  pendingImage = img;
  $('attach').hidden = !img;
  if (img) $('attach').querySelector('img').src = `data:${img.media_type};base64,${img.data}`;
}

function autosize() {
  const t = $('input');
  t.style.height = 'auto';
  t.style.height = `${Math.min(t.scrollHeight + 2, 160)}px`;
}
function syncControls() {
  $('modes').innerHTML = MODES.map((m) =>
    `<button class="chip" data-mode="${m.id}" aria-pressed="${m.id === prefs.mode}">${m.label}</button>`).join('')
    + `<button class="chip alt" data-compact aria-pressed="${prefs.compact}">compact output</button>`;
  $('input').placeholder = MODES.find((m) => m.id === prefs.mode)?.hint ?? '';
  $('variantsWrap').hidden = prefs.mode !== 'varyant';
  for (const k of ['target', 'rating', 'aspect', 'variants']) $(k).value = prefs[k];
  store.set('sapphire.prefs', prefs);
}

// ---------- drawer & settings ----------
async function renderChats() {
  const all = (await idb('readonly', (s) => s.getAll()).catch(() => [])).sort((a, b) => b.updated - a.updated);
  $('chats').innerHTML = all.length ? all.map((c) =>
    `<li class="${c.id === chat.id ? 'cur' : ''}"><button class="open" data-id="${c.id}">${esc(c.title || 'Untitled')}<small>${new Date(c.updated).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</small></button>`
    + `<button class="icon" data-del="${c.id}" aria-label="Delete"><svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg></button></li>`).join('')
    : '<li class="none">No saved chats yet.</li>';
}
async function openDrawer() { await renderChats(); $('drawer').classList.add('open'); $('scrim').hidden = false; }
function closeDrawer() { $('drawer').classList.remove('open'); $('scrim').hidden = true; }
function openSettings() {
  $('apiKey').value = settings.apiKey;
  $('claudeModel').value = settings.claudeModel;
  $('effort').value = settings.effort;
  $('buildMode').value = settings.buildMode;
  for (const k of ['palette', 'motifs', 'banned', 'signature']) $(`hs${k[0].toUpperCase()}${k.slice(1)}`).value = settings.house?.[k] ?? '';
  $('settings').showModal();
}

// ---------- events ----------
$('target').innerHTML = TARGETS.map((t) => `<option value="${t.id}">${t.label}</option>`).join('');
$('modes').addEventListener('click', (e) => {
  const x = $('modes').scrollLeft;
  const m = e.target.closest('[data-mode]');
  if (m) prefs.mode = m.dataset.mode;
  else if (e.target.closest('[data-compact]')) prefs.compact = !prefs.compact;
  else return;
  syncControls(); $('modes').scrollLeft = x;
});
for (const k of ['target', 'rating', 'aspect', 'variants']) $(k).addEventListener('change', (e) => { prefs[k] = e.target.value; syncControls(); });
$('input').addEventListener('input', autosize);
// Desktop: Enter sends, Shift+Enter makes a new line. Touch: Enter makes a new line, the button sends.
const desktop = matchMedia('(hover: hover) and (pointer: fine)');
$('input').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.isComposing) return;
  if (e.ctrlKey || e.metaKey || (desktop.matches && !e.shiftKey)) { e.preventDefault(); send(); }
});
$('input').addEventListener('paste', async (e) => {
  const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'));
  if (!f || $('imgBtn').hidden) return;
  e.preventDefault();
  try { setImage(await readImage(f)); } catch { toast('Could not read the image'); }
});
$('sendBtn').addEventListener('click', send);
$('imgBtn').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try { setImage(await readImage(f)); } catch { toast('Could not read the image'); }
});
$('attachDel').addEventListener('click', () => setImage(null));

thread.addEventListener('click', (e) => {
  const copy = e.target.closest('[data-copy]');
  if (copy) return copyText(copy.parentElement.querySelector('code').textContent);
  const ex = e.target.closest('[data-ex]');
  if (ex) {
    const x = EXAMPLES[ex.dataset.ex];
    prefs.mode = x.mode; syncControls();
    $('input').value = x.text; autosize(); $('input').focus();
    return;
  }
  const act = e.target.closest('[data-act]'); if (!act) return;
  if (act.dataset.act === 'settings') return openSettings();
  const it = chat.items[act.closest('.msg').dataset.i];
  if (act.dataset.act === 'copy') copyText(it.text);
  if (act.dataset.act === 'critic') runCritic(it);
});

$('menuBtn').addEventListener('click', openDrawer);
$('scrim').addEventListener('click', closeDrawer);
$('newBtn').addEventListener('click', () => {
  if (active) return toast('Stop the reply first');
  chat = newChat(); render(); renderChats(); $('input').focus();
});
$('chats').addEventListener('click', async (e) => {
  const del = e.target.closest('[data-del]');
  if (del) {
    if (!confirm('Delete this chat?')) return;
    await idb('readwrite', (s) => s.delete(del.dataset.del));
    if (del.dataset.del === chat.id) { chat = newChat(); render(); }
    return renderChats();
  }
  const open = e.target.closest('[data-id]'); if (!open) return;
  if (active) return toast('Stop the reply first');
  const c = await idb('readonly', (s) => s.get(open.dataset.id));
  if (c) { chat = c; render(); }
  closeDrawer(); renderChats();
});

$('setBtn').addEventListener('click', openSettings);
$('settings').addEventListener('close', () => {
  if ($('settings').returnValue !== 'save') return;
  settings.apiKey = $('apiKey').value.trim();
  settings.claudeModel = $('claudeModel').value;
  settings.effort = $('effort').value;
  settings.buildMode = $('buildMode').value;
  settings.house = {
    palette: $('hsPalette').value, motifs: $('hsMotifs').value,
    banned: $('hsBanned').value, signature: $('hsSignature').value,
  };
  store.set('sapphire.settings', settings);
  if (!chat.items.length) render();
  toast('Saved');
});
$('settings').addEventListener('click', (e) => { if (e.target === $('settings')) $('settings').close(); });
$('wipeBtn').addEventListener('click', async () => {
  if (!confirm('Delete the API key, settings and all chats from this device?')) return;
  localStorage.removeItem('sapphire.settings'); localStorage.removeItem('sapphire.prefs');
  await idb('readwrite', (s) => s.clear()).catch(() => {});
  location.reload();
});

syncControls();
render();
renderChats();
if (desktop.matches) $('input').focus();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
