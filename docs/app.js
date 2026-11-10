// RUVET. — app core. Backend-agnostic: a backend (backend-api.js, or the artifact backend) calls RUVET_START(backend).
window.RUVET_START = function (backend) {
'use strict';

// ---------- static data ----------
const TARGETS = [
  { id: 'tsubaki3', label: 'Tsubaki.3', build: 'TSUBAKI', pack: 'DESCRIPTION' },
  { id: 'flux', label: 'Flux', build: 'TSUBAKI', pack: 'DESCRIPTION' },
  { id: 'qwen-image', label: 'Qwen-Image', build: 'TSUBAKI', pack: 'DESCRIPTION' },
  { id: 'gpt-image', label: 'GPT-image', build: 'TSUBAKI', pack: 'DESCRIPTION' },
  { id: 'midjourney', label: 'Midjourney', build: 'TSUBAKI', pack: 'DESCRIPTION' },
  { id: 'illustrious', label: 'Illustrious', build: 'TAG', pack: 'TAG' },
  { id: 'noobai', label: 'NoobAI', build: 'TAG', pack: 'TAG' },
  { id: 'pony', label: 'Pony V6', build: 'TAG', pack: 'TAG' },
  { id: 'anima', label: 'Anima', build: 'ANIMA', pack: 'HYBRID' },
  { id: 'anima_aesthetic', label: 'Anima Aesthetic', build: 'ANIMA', pack: 'HYBRID' },
];
const MODES = [
  { id: 'auto', hint: 'Type an idea, a prompt or a problem…' },
  { id: 'generate', hint: 'Your idea → a finished prompt' },
  { id: 'variants', hint: 'Your idea → structurally different readings' },
  { id: 'audit', hint: 'Paste the prompt to audit' },
  { id: 'repair', hint: 'The prompt + what came out broken' },
  { id: 'image', hint: 'Attach an image, add a note if you like' },
  { id: 'discuss', hint: 'Let\'s discuss the idea…' },
];
const LENSES = ['literal', 'before', 'after', 'detail', 'environment', 'metaphor', 'scale shift'];
const TENSIONS = ['contrast object', 'absence', 'misplacement', 'scale', 'aftermath', 'defiance', 'stillness in motion'];
const ISSUES = ['broken hands', 'extra limbs', 'duplicate figure', 'melted face', 'warped background', 'wrong light', 'plastic look', 'style ignored', 'missing detail', 'gibberish text'];
const EXAMPLES = [
  { mode: 'generate', text: 'An old repairman fixing a carousel alone in a closed amusement park' },
  { mode: 'variants', text: 'A witch who missed the last train' },
  { mode: 'discuss', text: 'An underwater library — where does the idea break?' },
];
const VIEWS = ['studio', 'library', 'memory'];
const HOUSE = [['palette', 'Palette', 'e.g. cold blues, one warm accent'], ['motifs', 'Motifs', 'e.g. old electronics, rain'], ['banned', 'Banned', 'e.g. neon, cat ears'], ['signature', 'Signature', 'e.g. one red object in every scene']];
const HELPERS = {
  spark: 'You invent picture ideas for an anime/illustration prompt compiler. Reply with only a JSON array of 5 strings. Each string is one sentence of at most 22 words describing one frozen moment: a specific subject, a specific place, and one plausible, unexpected contrast that is cheap to draw (no crowds, no complex hand actions). Make the five differ in subject, setting, mood and time of day. Avoid stock imagery: no cherry blossoms, glowing eyes, lone figure on a rooftop, angel wings. Write in the language of the theme if one is given, otherwise English.',
  lessons: 'You maintain calibration lessons for an image-prompt compiler. You get the existing lessons and a list of render results the user reported for one image model (what worked, what failed and how). Reply with only a JSON array of at most 8 strings. Each string is one concrete, actionable rule of at most 22 words about staging, framing, hands, characters, background, light or style on this model. Keep existing lessons the results do not contradict, merge duplicates, and add only rules that at least one result supports. Do not mention concepts or subjects from the results.',
  style: 'You infer a person\'s standing visual taste from image prompts they chose to keep. Reply with only a JSON object with the string keys palette, motifs, banned, signature — each at most 14 words, describing what recurs across the prompts (banned = things they consistently avoid, or "" if unclear; signature = one recurring device, or "" if none). Use "" for anything the prompts do not support.',
};

// ---------- persistence ----------
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { toast('Could not save (storage may be full)'); } },
};
const cfg = store.get('ruvet.settings', {});
for (const f of backend.fields) cfg[f.id] ??= f.def ?? '';
const prefs = Object.assign({ mode: 'auto', targets: ['tsubaki3'], rating: 'general', aspect: '', variants: '3', compact: false, lens: '', tension: '', bold: 'balanced', full: true, optsOpen: false }, store.get('ruvet.prefs', {}));
prefs.targets = prefs.targets.filter((t) => TARGETS.some((x) => x.id === t)); if (!prefs.targets.length) prefs.targets = ['tsubaki3'];
const memory = Object.assign({ house: {}, lessons: {}, feedback: [], ledger: [] }, store.get('ruvet.memory', {}));
let library = store.get('ruvet.library', []);
const saveMemory = () => store.set('ruvet.memory', memory);
const saveLibrary = () => store.set('ruvet.library', library);

let dbp;
function db() {
  dbp ??= new Promise((res, rej) => {
    try {
      const r = indexedDB.open('ruvet', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('chats', { keyPath: 'id' });
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  });
  return dbp;
}
async function idb(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction('chats', mode); const rq = fn(t.objectStore('chats'));
    t.oncomplete = () => res(rq?.result); t.onerror = t.onabort = () => rej(t.error);
  });
}
const saveChat = () => { if (!chat.runs.length) return; chat.updated = Date.now(); return idb('readwrite', (s) => s.put(chat)).then(renderChats, () => {}); };

// ---------- state & helpers ----------
const $ = (id) => document.getElementById(id);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random());
const newChat = () => ({ id: uid(), title: '', updated: Date.now(), runs: [], sys: {}, fb: {} });
let chat = newChat();
let pendingImage = null; // { media_type, data }
let ctl = null, running = false, caps = { images: false };
const armed = new Set(); // two-tap confirmations
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const targetInfo = (id) => TARGETS.find((t) => t.id === id) ?? TARGETS[0];
const GEM = '<svg class="gem" viewBox="0 0 24 24"><path d="M7 3h10l5 6-10 12L2 9z"/><path d="M2 9h20M7 3l5 6 5-6M12 9v12"/></svg>';
let toastTimer;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3600); }
function copyText(text, codeEl) {
  const fallback = () => {
    if (codeEl) { const r = document.createRange(); r.selectNodeContents(codeEl); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('Text selected — copy it'); }
    else toast('Could not copy');
  };
  try { navigator.clipboard.writeText(text).then(() => toast('Copied'), fallback); } catch { fallback(); }
}
// Destructive buttons need a second tap: the first arms the button, the second runs it.
function confirmTap(key) { if (armed.has(key)) { armed.delete(key); return true; } armed.clear(); armed.add(key); return false; }
function parseJSON(text) {
  const t = text.replace(/```(?:json)?/g, '');
  const a = t.search(/[[{]/); const b = Math.max(t.lastIndexOf(']'), t.lastIndexOf('}'));
  if (a < 0 || b <= a) throw new Error('no JSON');
  return JSON.parse(t.slice(a, b + 1));
}

// ---------- markdown ----------
function inline(s) {
  return esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
}
const kindOf = (head) => (/pozitif|positive/i.test(head) ? 'pos' : /negatif|negative/i.test(head) ? 'neg' : '');
function codeBlock(text, kind) {
  return `<div class="code ${kind}"><pre><code>${esc(text)}</code></pre><div class="cbar">${kind === 'pos' ? '<button data-save>Save</button>' : ''}<button data-copy>Copy</button></div></div>`;
}
// Walks SAPPHIRE's report format; returns html and the fenced blocks with the heading they sit under.
function parseMd(src) {
  const out = [], blocks = []; let list = null, para = [], lastHead = '';
  const flushPara = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]; let m;
    if (/^\s*```/.test(line)) {
      flushPara(); flushList(); const code = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i]);
      const text = code.join('\n').trim(), kind = kindOf(lastHead);
      blocks.push({ kind, text }); out.push(codeBlock(text, kind));
    } else if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      flushPara(); flushList(); lastHead = m[2]; out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`);
    } else if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flushPara(); flushList(); out.push('<hr>'); }
    else if ((m = line.match(/^\s*(?:[-*•]|(\d+)[.)])\s+(.*)$/))) {
      flushPara(); const kind = m[1] ? 'ol' : 'ul';
      if (list !== kind) { flushList(); out.push(`<${kind}>`); list = kind; }
      out.push(`<li>${inline(m[2])}</li>`);
    } else if (!line.trim()) { flushPara(); flushList(); }
    else { flushList(); if (/^\s*(\*\*)?[^*]{0,40}(pozitif|positive|negatif|negative)[^*]{0,20}(\*\*)?:?\s*$/i.test(line)) lastHead = line; para.push(line); }
  }
  flushPara(); flushList();
  return { html: out.join(''), blocks };
}
const md = (s) => parseMd(s).html;
function extractBlocks(text) {
  const b = parseMd(text).blocks;
  return { pos: b.filter((x) => x.kind === 'pos').map((x) => x.text), neg: b.filter((x) => x.kind === 'neg').map((x) => x.text) };
}
// The prompt a result ends on: the critic's corrected blocks when it asked for a fix, otherwise the compiler's.
function finalBlocks(out) {
  const b = extractBlocks(out.text);
  if (out.critic?.pos) return { pos: out.critic.pos, neg: out.critic.neg ?? b.neg[0] ?? '', fixed: true, count: 1 };
  return { pos: b.pos[0] ?? '', neg: b.neg[0] ?? '', fixed: false, count: b.pos.length };
}

// ---------- lint: deterministic checks against the target pack's syntax ----------
function lint(target, pos, neg) {
  const pack = targetInfo(target).pack, L = [], low = pos.toLowerCase();
  const add = (lv, m) => L.push({ lv, m });
  const has = (w) => new RegExp('(^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)').test(low);
  const found = (list) => list.filter(has);
  const weights = [...pos.matchAll(/\(([^()]+):(\d(?:\.\d+)?)\)/g)];
  const pseudo = found(['perfect anatomy', 'perfect hands', 'correct anatomy', 'detailed hands', 'five fingers', 'anatomically correct']);
  if (pseudo.length) add('error', `Anatomy pseudo-terms do not fix anatomy: ${pseudo.join(', ')}`);
  const filler = found(['ultra detailed', 'ultra-detailed', 'highly detailed', '8k', '4k', 'stunning', 'intricate', 'ornate']);
  if (filler.length) add('warn', `Quality filler: ${filler.join(', ')}`);
  const cliche = found(['bokeh', 'sparkles', 'light particles', 'falling petals', 'lens flare', 'god rays', 'glowing eyes', 'rim light']);
  if (cliche.length) add('info', `Check these effects have a named source: ${cliche.join(', ')}`);
  let count;
  if (pack === 'DESCRIPTION') {
    const words = pos.split(/\s+/).filter(Boolean).length; count = `${words} words`;
    if (words > 150) add('warn', `${words} words — the pack's budget is 60–150`);
    if (words < 40) add('info', `${words} words — short for a description model`);
    if (weights.length) add('error', 'Weight syntax (tag:1.2) does nothing on a description model');
    const tagq = found(['masterpiece', 'best quality', 'absurdres']).concat(/score_\d/.test(low) ? ['score tags'] : []);
    if (tagq.length) add('error', `Tag-model quality strings in a description prompt: ${tagq.join(', ')}`);
    const commas = (pos.match(/,/g) || []).length, sentences = (pos.match(/[.!?](\s|$)/g) || []).length;
    if (words > 20 && commas > words * 0.2 && sentences < 3) add('warn', 'Reads like a tag pile — description models want connected sentences');
  } else {
    let tagPart = pos, sentences = 0;
    if (pack === 'HYBRID') {
      const cut = pos.search(/\.\s+[A-Z]/);
      if (cut > 0) { const start = pos.lastIndexOf(',', cut); sentences = (pos.slice(start + 1).match(/[.!?](\s|$)/g) || []).length; tagPart = pos.slice(0, start); }
    }
    const tags = tagPart.split(',').map((t) => t.trim()).filter(Boolean);
    count = `${tags.length} tags` + (sentences ? ` + ${sentences} sentences` : '');
    const [lo, hi, cap, negCap] = pack === 'TAG' ? [25, 40, 55, 25] : [20, 35, 45, 20];
    if (tags.length > cap) add('error', `${tags.length} tags — over the cap of ${cap}`);
    else if (tags.length > hi) add('warn', `${tags.length} tags — the budget is ${lo}–${hi}`);
    else if (tags.length < lo - 8) add('info', `${tags.length} tags — thin for this pack (${lo}–${hi})`);
    if (sentences > 3) add('warn', `${sentences} sentences — the hybrid pack allows 3`);
    if (pack === 'TAG') {
      if (weights.some((w) => +w[2] > 1.4)) add('error', 'A weight above 1.4');
      if (weights.length > 4) add('warn', `${weights.length} weighted tags — the limit is 4`);
      const upper = tags.filter((t) => /[A-Z]/.test(t) && t !== 'BREAK');
      if (upper.length) add('warn', `Uppercase in tags: ${upper.slice(0, 3).join(', ')}`);
    } else if (weights.length > 2) add('warn', `${weights.length} weighted tags — the hybrid pack allows 2`);
    if (target === 'anima_aesthetic' && /score_\d/.test(low + ' ' + neg.toLowerCase())) add('error', 'Anima Aesthetic takes no score tags anywhere');
    if (target === 'pony' && !/score_9/.test(low)) add('warn', 'Pony expects the score_9, score_8_up, score_7_up base');
    const negTags = neg.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
    if (negTags.length > negCap) add('warn', `${negTags.length} negative tags — the cap is ${negCap}`);
    const posSet = new Set(tags.map((t) => t.toLowerCase().replace(/^\(|:\d.*$/g, '')));
    const clash = negTags.filter((t) => posSet.has(t));
    if (clash.length) add('error', `Negative contradicts positive: ${clash.join(', ')}`);
  }
  return { items: L, count };
}

// ---------- memory: what earlier sessions taught, frozen into each chat when it starts ----------
function memoryBlock(target) {
  const parts = [];
  const hs = HOUSE.map(([k]) => [k, (memory.house[k] || '').trim()]).filter(([, v]) => v);
  if (hs.length) parts.push(`<house_style>\n${hs.map(([k, v]) => `${k}: ${v}`).join('\n')}\n</house_style>`);
  const lessons = memory.lessons[target] ?? [];
  const results = memory.feedback.filter((f) => f.target === target).slice(-8);
  const ledger = memory.ledger.slice(-3);
  if (lessons.length || results.length || ledger.length) {
    const m = [`<memory>`, `model: ${target}`];
    if (lessons.length) m.push('lessons:', ...lessons.map((l) => `- ${l}`));
    if (results.length) m.push('results:', ...results.map(resultLine));
    if (ledger.length) m.push('ledger:', ...ledger);
    m.push('</memory>'); parts.push(m.join('\n'));
  }
  return parts.length ? '\n' + parts.join('\n') + '\n' : '';
}
function resultLine(f) {
  return `- ${f.verdict}${f.issues?.length ? ` (${f.issues.join(', ')})` : ''}${f.note ? ` — ${f.note}` : ''}${f.ledger ? ` | ${f.ledger}` : ''}`;
}
function harvestLedger(text) {
  const lines = [...text.matchAll(/(?:Ledger|Defter):\**\s*(L\s*\|[^\n]+)/g)].map((m) => m[1].trim());
  if (!lines.length) return;
  for (const l of lines) { memory.ledger = memory.ledger.filter((x) => x !== l); memory.ledger.push(l); }
  memory.ledger = memory.ledger.slice(-6); saveMemory();
}
const lastLedger = (text) => [...text.matchAll(/(?:Ledger|Defter):\**\s*(L\s*\|[^\n]+)/g)].map((m) => m[1].trim()).pop() ?? '';

// ---------- request assembly ----------
async function systemFor(target) {
  chat.sys ??= {};
  chat.sys[target] ??= { build: cfg.build === 'universal' ? 'UNIVERSAL' : targetInfo(target).build, mem: memoryBlock(target) };
  return (await backend.loadPrompt(chat.sys[target].build)) + chat.sys[target].mem;
}
function compose(text, meta, target, hasImage, notes) {
  const head = [];
  if (meta.mode !== 'auto') head.push(`mode: ${meta.mode}`);
  head.push(`model: ${target}`, `rating: ${meta.rating}`);
  if (meta.aspect) head.push(`aspect: ${meta.aspect}`);
  if (meta.mode === 'variants') head.push(`variants: ${meta.variants}`);
  if (meta.compact) head.push('detail: compact');
  if (meta.lens) head.push(`lens: ${meta.lens}`);
  if (meta.tension) head.push(`tension: ${meta.tension}`);
  if (meta.bold !== 'balanced') head.push(`boldness: ${meta.bold}`);
  if (hasImage) head.push('image: attached to this message');
  for (const n of notes) head.push(`feedback: ${n}`);
  return `${head.join('\n')}\n\n${text}`.trim();
}
// What the next request should know about the last result for this target: a critic correction, a render report.
function notesFor(target) {
  const notes = [];
  const prev = [...chat.runs].reverse().find((r) => r.outs[target]?.done);
  const c = prev?.outs[target].critic;
  if (c?.pos) notes.push(`an auditor corrected the previous output; its current version is — positive: ${c.pos.replace(/\s+/g, ' ')}${c.neg ? ` — negative: ${c.neg.replace(/\s+/g, ' ')}` : ''}`);
  for (const f of chat.fb?.[target] ?? []) notes.push(f);
  return notes;
}
// Claude keeps nothing between calls: replay this target's branch — its own results where it has them, another target's text otherwise.
function historyFor(target, upto) {
  const turns = [];
  for (const r of chat.runs) {
    const user = { role: 'user', text: r.composed[target] ?? Object.values(r.composed)[0], image: r.image };
    if (r === upto) { turns.push(user); break; }
    const own = r.outs[target]?.done ? r.outs[target] : null;
    const o = own ?? Object.values(r.outs).find((x) => x.done);
    if (!o) continue;
    turns.push(user, { role: 'assistant', text: o.text, raw: own ? o.raw : undefined });
  }
  return turns;
}
const ask = (req) => backend.ask({ cfg, signal: ctl?.signal, onText() {}, ...req });

// ---------- the pipeline: compile → lint → critic → fix ----------
async function pipeline(run, target) {
  const out = run.outs[target] = { text: '', stage: 'compile' };
  paint(run);
  try {
    const res = await ask({ system: await systemFor(target), turns: historyFor(target, run), onText: (t) => { out.text = t; paint(run); } });
    out.text = res.text; out.raw = res.raw;
    if (res.refused) { out.stage = 'done'; out.x = true; out.text ||= 'The model declined this request.'; out.note = 'Declined — this result is left out of later requests.'; return; }
    out.done = true;
    if (res.truncated) out.note = 'The reply was cut short; you can type "continue".';
    harvestLedger(out.text);
    const b = finalBlocks(out);
    if (b.pos) {
      out.lint = lint(target, b.pos, b.neg);
      if (run.meta.full) await critic(run, target, out);
    }
  } catch (e) {
    const msg = backend.describeError(e);
    if (out.done) { if (msg) out.note = `Critic step failed: ${msg}`; if (out.critic?.pending) delete out.critic; }
    else if (msg === null && out.text) { out.x = true; out.note = 'Stopped — this result is left out of later requests.'; }
    else { delete run.outs[target]; if (msg) toast(msg); return; }
  }
  out.stage = 'done'; paint(run);
}
async function critic(run, target, out) {
  out.stage = 'critic'; out.critic = { text: '', pending: true }; paint(run);
  const res = await ask({
    system: await backend.loadPrompt('CRITIC'),
    turns: [{ role: 'user', text: `Target model: ${target}\n\nSAPPHIRE output to audit:\n\n${out.text}` }],
    onText: (t) => { out.critic.text = t; paint(run); },
  });
  const c = out.critic = { text: res.text };
  c.verdict = (res.text.match(/(?:Verdict|Karar):?\**:?\s*\**\s*(PASS|FIX|REJECT|GEÇTİ|DÜZELT|REDDET)/i)?.[1] ?? '').toUpperCase();
  c.verdict = { 'GEÇTİ': 'PASS', 'DÜZELT': 'FIX', 'REDDET': 'REJECT' }[c.verdict] ?? c.verdict;
  if (c.verdict === 'FIX') {
    const fixed = extractBlocks(res.text);
    if (fixed.pos[0]) { c.pos = fixed.pos[0]; c.neg = fixed.neg[0]; const b = finalBlocks(out); out.lint = lint(target, b.pos, b.neg); }
  }
}

async function send() {
  if (running) { ctl?.abort(); return; }
  const input = $('input'), text = input.value.trim();
  if (!text && !pendingImage) return;
  const need = backend.needs(cfg);
  if (need) { openSettings(); toast(need); return; }
  const meta = { ...prefs, targets: [...prefs.targets] }, image = pendingImage;
  const run = { id: uid(), text, meta, image, composed: {}, outs: {}, tab: meta.targets[0] };
  for (const t of meta.targets) run.composed[t] = compose(text, meta, t, !!image, notesFor(t));
  const fbBefore = chat.fb; chat.fb = {};
  chat.runs.push(run); chat.title ||= (text || 'Image').slice(0, 60);
  input.value = ''; autosize(); setImage(null); $('sparks').hidden = true;
  running = true; ctl = new AbortController(); setBusy(true); renderThread();
  for (const t of meta.targets) { if (ctl.signal.aborted) break; await pipeline(run, t); }
  running = false; ctl = null; setBusy(false);
  if (!Object.keys(run.outs).length) {
    // Nothing usable came back: roll the run back and return the text to the composer.
    chat.runs.pop(); chat.fb = fbBefore; input.value = text; autosize(); setImage(image);
  }
  renderThread(); saveChat();
}
async function runCritic(run, target) {
  const out = run.outs[target];
  if (running || !out?.done) return;
  running = true; ctl = new AbortController(); setBusy(true);
  try { await critic(run, target, out); }
  catch (e) { const msg = backend.describeError(e); delete out.critic; if (msg) toast(msg); }
  out.stage = 'done'; running = false; ctl = null; setBusy(false); paint(run); saveChat();
}

// ---------- learning ----------
function recordFeedback(run, target, verdict, issues, note) {
  const out = run.outs[target];
  out.fb = verdict;
  memory.feedback.push({ id: uid(), ts: Date.now(), target, verdict, issues, note, concept: run.text.slice(0, 120), ledger: lastLedger(out.text) });
  memory.feedback = memory.feedback.slice(-200); saveMemory();
  if (run === chat.runs.at(-1)) {
    chat.fb ??= {}; (chat.fb[target] ??= []).push(verdict === 'worked' ? 'the previous output rendered well; keep what made it work'
      : `the previous output failed on render${issues.length ? `: ${issues.join(', ')}` : ''}${note ? ` — ${note}` : ''}`);
  }
  saveChat(); renderNav();
  toast(`Noted — RUVET will use this for ${targetInfo(target).label}`);
}
const unlearned = (target) => memory.feedback.filter((f) => f.target === target && !f.learned).length;
async function learnLessons(target) {
  const results = memory.feedback.filter((f) => f.target === target).slice(-40);
  const res = await helper(HELPERS.lessons, `Model: ${target}\n\nExisting lessons:\n${(memory.lessons[target] ?? []).map((l) => `- ${l}`).join('\n') || '(none)'}\n\nResults:\n${results.map(resultLine).join('\n')}`);
  if (!res) return;
  const list = parseJSON(res);
  if (!Array.isArray(list)) throw new Error('not a list');
  memory.lessons[target] = list.map(String).filter(Boolean).slice(0, 8);
  for (const f of memory.feedback) if (f.target === target) f.learned = true;
  saveMemory(); toast(`${memory.lessons[target].length} lessons for ${targetInfo(target).label}`);
}
async function learnStyle() {
  if (library.length < 3) return toast('Save at least 3 prompts to the library first');
  const res = await helper(HELPERS.style, library.slice(0, 30).map((x, i) => `${i + 1}. ${x.positive}`).join('\n\n'));
  if (!res) return;
  const s = parseJSON(res);
  for (const [k] of HOUSE) if (typeof s[k] === 'string' && s[k].trim()) memory.house[k] = s[k].trim();
  saveMemory(); toast('House style updated from your library');
}
async function helper(system, text) {
  if (running) { toast('Stop the current run first'); return null; }
  const need = backend.needs(cfg);
  if (need) { openSettings(); toast(need); return null; }
  running = true; ctl = new AbortController(); setBusy(true);
  try { return (await ask({ system, turns: [{ role: 'user', text }], quick: true })).text; }
  catch (e) { const msg = backend.describeError(e); if (msg) toast(msg); return null; }
  finally { running = false; ctl = null; setBusy(false); }
}
async function spark() {
  const theme = $('input').value.trim();
  const box = $('sparks'); box.hidden = false; box.innerHTML = '<span class="dots"><i></i><i></i><i></i>Sparking ideas…</span>';
  const hs = HOUSE.map(([k]) => memory.house[k] && `${k}: ${memory.house[k]}`).filter(Boolean).join('; ');
  const res = await helper(HELPERS.spark, `Theme: ${theme || '(none — surprise me)'}\n${hs ? `Taste: ${hs}\n` : ''}${memory.ledger.length ? `Recently done, so go elsewhere:\n${memory.ledger.slice(-3).join('\n')}` : ''}`);
  let ideas = [];
  try { ideas = res ? parseJSON(res).map(String) : []; } catch { /* handled below */ }
  if (!ideas.length) { box.hidden = true; if (res) toast('Could not read the ideas; try again'); return; }
  box.innerHTML = ideas.map((t) => `<button data-idea>${esc(t)}</button>`).join('') + '<button class="dim" data-close>Close</button>';
}

// ---------- rendering: studio ----------
const thread = $('thread');
function pipeHTML(run, target, out) {
  const b = finalBlocks(out), st = [];
  st.push(['Compile', out.done ? 'ok' : out.x ? 'err' : 'run']);
  if (b.pos) {
    const errs = out.lint?.items.filter((i) => i.lv === 'error').length ?? 0, warns = out.lint?.items.filter((i) => i.lv === 'warn').length ?? 0;
    st.push([errs ? `Lint · ${errs} error${errs > 1 ? 's' : ''}` : warns ? `Lint · ${warns} warning${warns > 1 ? 's' : ''}` : 'Lint · clean', errs ? 'err' : warns ? 'warn' : 'ok']);
    const c = out.critic;
    if (c?.pending) st.push(['Critic', 'run']);
    else if (c) st.push([`Critic · ${c.verdict || 'done'}`, c.verdict === 'PASS' ? 'ok' : c.verdict === 'REJECT' ? 'err' : 'warn']);
    else if (run.meta.full && out.stage !== 'done') st.push(['Critic', '']);
    if (c?.pos) st.push(['Fix applied', 'ok']);
  }
  return `<div class="pipe">${st.map(([l, s]) => `<span class="st ${s}">${l}</span>`).join('<span class="sep"></span>')}</div>`;
}
function outHTML(run, target) {
  const out = run.outs[target];
  if (!out) return `<span class="dots">${running ? '<i></i><i></i><i></i>Waiting…' : 'No result for this model.'}</span>`;
  if (!out.text) return pipeHTML(run, target, out) + '<span class="dots"><i></i><i></i><i></i>Thinking…</span>';
  const b = finalBlocks(out), done = out.stage === 'done', h = [pipeHTML(run, target, out)];
  const risk = out.text.match(/Risk:\**\s*(\d+)\s*\(([^)]+)\)/);
  if (b.pos) {
    const pills = [];
    if (risk) pills.push(`<span class="pill ${+risk[1] <= 5 ? 'good' : +risk[1] <= 7 ? 'mid' : 'bad'}">risk ${risk[1]} · ${esc(risk[2])}</span>`);
    if (out.lint) pills.push(`<span class="pill">${out.lint.count}</span>`);
    if (b.count > 1) pills.push(`<span class="pill">${b.count} variants</span>`);
    if (out.fb) pills.push(`<span class="pill ${out.fb === 'worked' ? 'good' : 'bad'}">${out.fb}</span>`);
    h.push(`<div class="sum">${pills.join('')}</div>`);
  }
  if (b.fixed) h.push(`<div class="final"><h4>Final prompt — corrected by the critic</h4>${codeBlock(b.pos, 'pos')}${b.neg ? codeBlock(b.neg, 'neg') : ''}</div>`);
  h.push(b.fixed ? `<details class="sec"><summary>Original report</summary><div class="md">${md(out.text)}</div></details>` : `<div class="md">${md(out.text)}</div>`);
  if (out.critic?.text) h.push(`<details class="sec"${out.critic.pending ? ' open' : ''}><summary>Critic findings${out.critic.verdict ? ` — ${out.critic.verdict}` : ''}</summary><div class="md">${md(out.critic.text)}</div></details>`);
  if (out.lint?.items.length) h.push(`<details class="sec" open><summary>Lint</summary><ul class="lint">${out.lint.items.map((i) => `<li class="${i.lv}">${esc(i.m)}</li>`).join('')}</ul></details>`);
  if (out.note) h.push(`<div class="note">${esc(out.note)}</div>`);
  if (done && b.pos) {
    h.push(`<div class="actions"><button class="btn primary" data-act="copyp">Copy prompt</button>${b.neg ? '<button class="btn" data-act="copyn">Copy negative</button>' : ''}`
      + `<button class="btn" data-act="save">Save</button>`
      + (out.done && !out.critic ? '<button class="btn" data-act="critic">Run critic</button>' : '')
      + `<button class="btn ${out.fb === 'worked' ? 'on' : ''}" data-act="worked">Worked</button><button class="btn ${out.fb === 'failed' ? 'off' : ''}" data-act="failed">Failed</button></div>`);
    if (run.fbOpen === target) {
      const d = run.fbDraft ?? { issues: [] };
      h.push(`<div class="fb"><p>What went wrong in the render? RUVET remembers this for ${esc(targetInfo(target).label)}.</p>
        <div class="chips wrap">${ISSUES.map((i) => `<button class="chip" data-issue="${i}" aria-pressed="${d.issues.includes(i)}">${i}</button>`).join('')}</div>
        <div class="rowx"><input id="fbNote" placeholder="Anything else? (optional)" value="${esc(d.note ?? '')}"></div>
        <div class="rowx"><button class="btn primary" data-act="fbrepair">Save and repair</button><button class="btn" data-act="fbsave">Save only</button><button class="btn" data-act="fbcancel">Cancel</button></div></div>`);
    }
  } else if (done && out.text) h.push('<div class="actions"><button class="btn" data-act="copyall">Copy</button></div>');
  return h.join('');
}
function runHTML(run, i) {
  const m = run.meta, tgs = m.targets;
  const tags = [m.mode !== 'auto' && m.mode, tgs.length === 1 && targetInfo(tgs[0]).label, m.rating !== 'general' && m.rating, m.aspect, m.lens && `lens: ${m.lens}`, m.tension && `tension: ${m.tension}`, m.bold !== 'balanced' && m.bold, m.compact && 'compact', !m.full && 'no critic']
    .filter(Boolean).map((t) => `<span>${esc(t)}</span>`).join('');
  const tab = tgs.includes(run.tab) ? run.tab : tgs[0], out = run.outs[tab];
  return `<div class="run" data-i="${i}"><div class="user">${run.image ? `<img alt="Attached image" src="data:${run.image.media_type};base64,${run.image.data}">` : ''}${run.text ? `<div class="bubble">${esc(run.text)}</div>` : ''}<div class="tags">${tags}</div></div>`
    + (tgs.length > 1 ? `<div class="tabs">${tgs.map((t) => `<button data-tab="${t}" aria-pressed="${t === tab}">${esc(targetInfo(t).label)}${run.outs[t]?.stage === 'done' ? '' : run.outs[t] ? ' …' : ''}</button>`).join('')}</div>` : '')
    + `<div class="card${out?.x ? ' x' : ''}">${outHTML(run, tab)}</div></div>`;
}
function renderThread() {
  if (!chat.runs.length) {
    const need = backend.needs(cfg);
    thread.innerHTML = `<div class="empty">${GEM}<h2>One idea in, a render-ready prompt out</h2>
      <p>Describe a picture, pick the image models you use, and RUVET compiles a prompt in each model's own dialect — then checks its own work.</p>
      <div class="flow"><span>Compile</span><span>Lint</span><span>Critic</span><span>Fix</span><span>Learn from your renders</span></div>
      <div class="ex">${EXAMPLES.map((e, i) => `<button data-ex="${i}">${esc(e.text)}<small>${e.mode}</small></button>`).join('')}</div>
      ${need ? `<button class="warnbox" data-act="settings">${esc(need)} →</button>` : ''}</div>`;
    return;
  }
  thread.innerHTML = chat.runs.map(runHTML).join('');
  thread.scrollTop = thread.scrollHeight;
}
const dirty = new Set(); let raf = 0;
function paint(run) {
  dirty.add(run);
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    const stick = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 140;
    for (const r of dirty) {
      const i = chat.runs.indexOf(r), el = thread.querySelector(`.run[data-i="${i}"]`);
      if (i >= 0 && el) el.outerHTML = runHTML(r, i);
    }
    dirty.clear();
    if (stick) thread.scrollTop = thread.scrollHeight;
  });
}
function setBusy(b) { document.body.classList.toggle('busy', b); $('sendBtn').setAttribute('aria-label', b ? 'Stop' : 'Send'); }

// ---------- rendering: library ----------
let libQuery = '', libTarget = '';
function saveToLibrary(positive, negative, run, target) {
  if (library.some((x) => x.positive === positive)) return toast('Already in the library');
  library.unshift({ id: uid(), ts: Date.now(), title: (run?.text || positive).slice(0, 70), target, rating: run?.meta.rating ?? 'general', concept: run?.text ?? '', positive, negative });
  saveLibrary(); renderNav(); toast('Saved to the library');
}
function renderLibrary() {
  const q = libQuery.toLowerCase();
  const items = library.filter((x) => (!libTarget || x.target === libTarget) && (!q || (x.title + ' ' + x.positive).toLowerCase().includes(q)));
  const used = [...new Set(library.map((x) => x.target))];
  $('library').innerHTML = `<h2>Library</h2><p class="lead">Prompts you kept. RUVET can also learn your house style from them (Memory tab).</p>
    <div class="toolbar"><input id="libQ" placeholder="Search saved prompts" value="${esc(libQuery)}">
      <select id="libT" aria-label="Model"><option value="">All models</option>${used.map((t) => `<option value="${t}"${t === libTarget ? ' selected' : ''}>${esc(targetInfo(t).label)}</option>`).join('')}</select>
      <button class="btn" data-l="export">Copy all as JSON</button><button class="btn" data-l="import">Import</button></div>
    <div id="libImport" hidden class="panel"><div class="field">Paste a JSON export<textarea id="libJson" rows="4"></textarea></div><div class="rowx"><button class="btn primary" data-l="doimport">Add to library</button></div></div>
    <div id="libList">${libraryList(items)}</div>`;
}
function libraryList(items) {
  return items.length ? items.map((x) => `<div class="panel item" data-id="${x.id}"><h3>${esc(x.title)}</h3>
      <div class="meta"><span class="pill">${esc(targetInfo(x.target).label)}</span><span class="pill">${esc(x.rating)}</span><span class="pill">${new Date(x.ts).toLocaleDateString()}</span></div>
      ${codeBlock(x.positive, 'pos').replace('<button data-save>Save</button>', '')}${x.negative ? codeBlock(x.negative, 'neg') : ''}
      <div class="actions"><button class="btn" data-l="remix">Remix as variants</button><button class="btn ${armed.has('lib' + x.id) ? 'danger' : ''}" data-l="del">${armed.has('lib' + x.id) ? 'Delete?' : 'Delete'}</button></div></div>`).join('')
    : `<p class="none">${library.length ? 'Nothing matches.' : 'Nothing saved yet. Use Save on any result in the Studio.'}</p>`;
}

// ---------- rendering: memory ----------
function renderMemory() {
  const models = TARGETS.filter((t) => (memory.lessons[t.id]?.length) || memory.feedback.some((f) => f.target === t.id));
  $('memory').innerHTML = `<h2>Memory</h2><p class="lead">What RUVET has learned from you. It is added to every new chat, and everything here is editable. It stays on this device.</p>
    <div class="panel"><h3>House style</h3><p class="hint">Your standing aesthetic. Applied unless a concept overrides it.</p>
      <div class="fields">${HOUSE.map(([k, l, p]) => `<label class="field">${l}<input data-house="${k}" placeholder="${p}" value="${esc(memory.house[k] ?? '')}"></label>`).join('')}</div>
      <div class="rowx"><button class="btn" data-m="style">Learn from my library (${library.length} saved)</button></div></div>
    ${models.map((t) => {
      const ls = memory.lessons[t.id] ?? [], fb = memory.feedback.filter((f) => f.target === t.id), n = unlearned(t.id);
      return `<div class="panel" data-target="${t.id}"><h3>${esc(t.label)} <span class="pill">${fb.filter((f) => f.verdict === 'worked').length} worked</span><span class="pill">${fb.filter((f) => f.verdict === 'failed').length} failed</span></h3>
        <p class="hint">Lessons are standing rules for this model. Recent results are sent as they are; "Learn" condenses them into lessons.</p>
        <ul class="lessons">${ls.map((l, i) => `<li><span>${esc(l)}</span><button class="x" data-m="dellesson" data-i="${i}" aria-label="Remove lesson">×</button></li>`).join('') || '<li><span class="none" style="padding:4px 0;text-align:left">No lessons yet.</span></li>'}</ul>
        <div class="rowx"><input data-newlesson placeholder="Add a rule yourself, e.g. keep both hands parked in full-body shots" style="flex:1 1 220px;min-width:0;background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:9px 12px;font-size:16px"><button class="btn" data-m="addlesson">Add</button>
          <button class="btn ${n ? 'primary' : ''}" data-m="learn" ${fb.length ? '' : 'disabled'}>Learn from results${n ? ` (${n} new)` : ''}</button></div>
        <details class="sec"><summary>Recent results (${fb.length})</summary><ul class="lessons">${fb.slice(-12).reverse().map((f) => `<li><span>${esc(f.verdict)}${f.issues?.length ? ` — ${esc(f.issues.join(', '))}` : ''}${f.note ? ` — ${esc(f.note)}` : ''}<small>${esc(f.concept || '')}</small></span><button class="x" data-m="delfb" data-id="${f.id}" aria-label="Remove result">×</button></li>`).join('')}</ul></details></div>`;
    }).join('') || '<div class="panel"><h3>Model lessons</h3><p class="hint" style="margin:0">Nothing yet. After you render a prompt, mark the result Worked or Failed in the Studio — RUVET keeps what it learns per model.</p></div>'}
    <div class="panel"><h3>Diversity ledger</h3><p class="hint">The last compositions RUVET produced. New chats avoid repeating their lens, light, palette and staging.</p>
      ${memory.ledger.length ? `<ul class="lessons">${memory.ledger.slice().reverse().map((l) => `<li><span class="mono">${esc(l)}</span></li>`).join('')}</ul><div class="rowx"><button class="btn" data-m="clearledger">${armed.has('ledger') ? 'Clear?' : 'Clear ledger'}</button></div>` : '<p class="hint" style="margin:0">Empty.</p>'}</div>`;
}

// ---------- shell ----------
function renderNav() {
  const view = document.body.dataset.view, n = { library: library.length, memory: TARGETS.reduce((a, t) => a + unlearned(t.id), 0) };
  $('views').innerHTML = VIEWS.map((v) => `<button data-view="${v}" aria-pressed="${v === view}">${v[0].toUpperCase() + v.slice(1)}${n[v] ? `<span class="n">${n[v]}</span>` : ''}</button>`).join('');
}
function setView(v) {
  document.body.dataset.view = v; armed.clear();
  $('library').hidden = v !== 'library'; $('memory').hidden = v !== 'memory';
  if (v === 'library') renderLibrary();
  if (v === 'memory') renderMemory();
  renderNav();
}
function syncControls() {
  $('modes').innerHTML = MODES.map((m) => `<button class="chip" data-mode="${m.id}" aria-pressed="${m.id === prefs.mode}">${m.id}</button>`).join('');
  $('targets').innerHTML = TARGETS.map((t) => `<button class="chip" data-target="${t.id}" aria-pressed="${prefs.targets.includes(t.id)}">${esc(t.label)}</button>`).join('');
  $('toggles').innerHTML = `<button class="chip alt" data-toggle="full" aria-pressed="${prefs.full}">critic + auto-fix</button><button class="chip alt" data-toggle="compact" aria-pressed="${prefs.compact}">compact output</button>`;
  $('input').placeholder = MODES.find((m) => m.id === prefs.mode)?.hint ?? '';
  $('variantsWrap').hidden = prefs.mode !== 'variants';
  for (const k of ['rating', 'aspect', 'variants', 'lens', 'tension', 'bold']) $(k).value = prefs[k];
  const names = prefs.targets.map((t) => targetInfo(t).label);
  $('optsText').textContent = [names.length > 2 ? `${names.length} models` : names.join(' + '), prefs.rating, prefs.aspect, prefs.lens && `lens: ${prefs.lens}`, prefs.tension && `tension: ${prefs.tension}`, prefs.bold !== 'balanced' && prefs.bold, prefs.full ? 'critic on' : 'critic off'].filter(Boolean).join(' · ');
  $('opts').hidden = !prefs.optsOpen; $('optsBtn').setAttribute('aria-expanded', prefs.optsOpen);
  store.set('ruvet.prefs', prefs);
}
function autosize() { const t = $('input'); t.style.height = 'auto'; t.style.height = `${Math.min(t.scrollHeight + 2, 160)}px`; }
async function readImage(file) {
  const bmp = await createImageBitmap(file), k = Math.min(1, 1568 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
  return { media_type: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.88).split(',')[1] };
}
function setImage(img) { pendingImage = img; $('attach').hidden = !img; if (img) $('attach').querySelector('img').src = `data:${img.media_type};base64,${img.data}`; }
async function renderChats() {
  const all = (await idb('readonly', (s) => s.getAll()).catch(() => [])).sort((a, b) => b.updated - a.updated);
  $('chats').innerHTML = all.length ? all.map((c) =>
    `<li class="${c.id === chat.id ? 'cur' : ''}"><button class="open" data-id="${c.id}">${esc(c.title || 'Untitled')}<small>${new Date(c.updated).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</small></button>`
    + (armed.has('chat' + c.id) ? `<button class="x sure" data-del="${c.id}">Delete?</button>`
      : `<button class="icon" data-del="${c.id}" aria-label="Delete"><svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg></button>`) + '</li>').join('')
    : '<li class="none" style="padding:10px 8px;text-align:left">No saved chats yet.</li>';
}
async function openDrawer() { await renderChats(); $('drawer').classList.add('open'); $('scrim').hidden = false; }
function closeDrawer() { armed.clear(); $('drawer').classList.remove('open'); $('scrim').hidden = true; }
function openSettings() {
  $('setFields').innerHTML = backend.fields.map((f) => `<label class="field">${esc(f.label)}${f.type === 'select'
    ? `<select id="f-${f.id}">${f.options.map(([v, l]) => `<option value="${v}"${cfg[f.id] === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`
    : `<input id="f-${f.id}" type="${f.type}" autocomplete="off" placeholder="${esc(f.placeholder ?? '')}" value="${esc(cfg[f.id] ?? '')}">`}${f.hint ? `<small>${esc(f.hint)}</small>` : ''}</label>`).join('');
  armed.clear(); $('wipeBtn').textContent = 'Delete all data';
  $('settings').showModal();
}

// ---------- events ----------
const fillSelect = (id, list) => { $(id).innerHTML = '<option value="">auto</option>' + list.map((x) => `<option>${x}</option>`).join(''); };
fillSelect('lens', LENSES); fillSelect('tension', TENSIONS);
$('views').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) setView(b.dataset.view); });
$('modes').addEventListener('click', (e) => { const m = e.target.closest('[data-mode]'); if (!m) return; const x = $('modes').scrollLeft; prefs.mode = m.dataset.mode; syncControls(); $('modes').scrollLeft = x; });
$('targets').addEventListener('click', (e) => {
  const b = e.target.closest('[data-target]'); if (!b) return;
  const t = b.dataset.target, on = prefs.targets.includes(t);
  if (on && prefs.targets.length === 1) return toast('Keep at least one target model');
  if (!on && prefs.targets.length === 4) return toast('Four models at a time is the limit');
  prefs.targets = on ? prefs.targets.filter((x) => x !== t) : [...prefs.targets, t]; syncControls();
});
$('toggles').addEventListener('click', (e) => { const b = e.target.closest('[data-toggle]'); if (!b) return; prefs[b.dataset.toggle] = !prefs[b.dataset.toggle]; syncControls(); });
$('optsBtn').addEventListener('click', () => { prefs.optsOpen = !prefs.optsOpen; syncControls(); });
for (const k of ['rating', 'aspect', 'variants', 'lens', 'tension', 'bold']) $(k).addEventListener('change', (e) => { prefs[k] = e.target.value; syncControls(); });
const desktop = matchMedia('(hover: hover) and (pointer: fine)');
$('input').addEventListener('input', autosize);
$('input').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.isComposing) return;
  if (e.ctrlKey || e.metaKey || (desktop.matches && !e.shiftKey)) { e.preventDefault(); send(); }
});
$('input').addEventListener('paste', async (e) => {
  const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'));
  if (!f || !caps.images) return;
  e.preventDefault();
  try { setImage(await readImage(f)); } catch { toast('Could not read the image'); }
});
$('sendBtn').addEventListener('click', send);
$('sparkBtn').addEventListener('click', spark);
$('sparks').addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) { $('sparks').hidden = true; return; }
  const b = e.target.closest('[data-idea]'); if (!b) return;
  $('input').value = b.textContent; autosize(); $('sparks').hidden = true; $('input').focus();
});
$('imgBtn').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try { setImage(await readImage(f)); } catch { toast('Could not read the image'); }
});
$('attachDel').addEventListener('click', () => setImage(null));

// Copy / Save on any prompt block, anywhere in the app.
document.addEventListener('click', (e) => {
  const copy = e.target.closest('[data-copy]'), save = e.target.closest('[data-save]');
  if (!copy && !save) return;
  const block = (copy ?? save).closest('.code'), code = block.querySelector('code');
  if (copy) return copyText(code.textContent, code);
  const runEl = block.closest('.run'), run = runEl && chat.runs[runEl.dataset.i];
  let neg = block.nextElementSibling; while (neg && !neg.classList?.contains('neg')) neg = neg.classList?.contains('pos') ? null : neg.nextElementSibling;
  saveToLibrary(code.textContent, neg?.querySelector('code').textContent ?? '', run, run ? (run.meta.targets.includes(run.tab) ? run.tab : run.meta.targets[0]) : prefs.targets[0]);
});
thread.addEventListener('input', (e) => {
  if (e.target.id !== 'fbNote') return;
  const run = chat.runs[e.target.closest('.run').dataset.i]; (run.fbDraft ??= { issues: [] }).note = e.target.value;
});
thread.addEventListener('click', (e) => {
  const ex = e.target.closest('[data-ex]');
  if (ex) { const x = EXAMPLES[ex.dataset.ex]; prefs.mode = x.mode; syncControls(); $('input').value = x.text; autosize(); $('input').focus(); return; }
  if (e.target.closest('[data-act="settings"]')) return openSettings();
  const runEl = e.target.closest('.run'); if (!runEl) return;
  const run = chat.runs[runEl.dataset.i], target = run.meta.targets.includes(run.tab) ? run.tab : run.meta.targets[0], out = run.outs[target];
  const tab = e.target.closest('[data-tab]');
  if (tab) { run.tab = tab.dataset.tab; return paint(run); }
  const issue = e.target.closest('[data-issue]');
  if (issue) { const d = run.fbDraft ??= { issues: [] }; const i = issue.dataset.issue; d.issues = d.issues.includes(i) ? d.issues.filter((x) => x !== i) : [...d.issues, i]; return paint(run); }
  const act = e.target.closest('[data-act]')?.dataset.act; if (!act || !out) return;
  const b = finalBlocks(out);
  if (act === 'copyp') copyText(b.pos);
  else if (act === 'copyn') copyText(b.neg);
  else if (act === 'copyall') copyText(out.text);
  else if (act === 'save') saveToLibrary(b.pos, b.neg, run, target);
  else if (act === 'critic') runCritic(run, target);
  else if (act === 'worked') { run.fbOpen = null; recordFeedback(run, target, 'worked', [], ''); paint(run); }
  else if (act === 'failed') { run.fbOpen = run.fbOpen === target ? null : target; paint(run); }
  else if (act === 'fbcancel') { run.fbOpen = null; paint(run); }
  else if (act === 'fbsave' || act === 'fbrepair') {
    const d = run.fbDraft ?? { issues: [] }, note = (d.note ?? '').trim();
    if (!d.issues.length && !note) return toast('Pick what went wrong, or add a note');
    recordFeedback(run, target, 'failed', d.issues, note); run.fbOpen = null; run.fbDraft = null; paint(run);
    if (act === 'fbrepair') {
      prefs.mode = 'repair'; prefs.targets = [target]; syncControls();
      $('input').value = `The render failed: ${[...d.issues, note].filter(Boolean).join(', ')}.`; autosize(); $('input').focus();
      toast(caps.images ? 'Attach the failed render if you have it, then send' : 'Describe the failure, then send');
    }
  }
});
$('library').addEventListener('input', (e) => {
  if (e.target.id === 'libQ') { libQuery = e.target.value; const q = libQuery.toLowerCase(); $('libList').innerHTML = libraryList(library.filter((x) => (!libTarget || x.target === libTarget) && (!q || (x.title + ' ' + x.positive).toLowerCase().includes(q)))); }
});
$('library').addEventListener('change', (e) => { if (e.target.id === 'libT') { libTarget = e.target.value; renderLibrary(); } });
$('library').addEventListener('click', (e) => {
  const a = e.target.closest('[data-l]')?.dataset.l; if (!a) return;
  const item = library.find((x) => x.id === e.target.closest('.item')?.dataset.id);
  if (a === 'export') copyText(JSON.stringify(library, null, 1));
  else if (a === 'import') $('libImport').hidden = !$('libImport').hidden;
  else if (a === 'doimport') {
    try {
      const list = JSON.parse($('libJson').value).filter((x) => x && typeof x.positive === 'string');
      const fresh = list.filter((x) => !library.some((y) => y.positive === x.positive)).map((x) => ({ id: uid(), ts: +x.ts || Date.now(), title: String(x.title ?? x.positive).slice(0, 70), target: targetInfo(x.target).id, rating: String(x.rating ?? 'general'), concept: String(x.concept ?? ''), positive: x.positive, negative: String(x.negative ?? '') }));
      library = [...fresh, ...library]; saveLibrary(); renderLibrary(); renderNav(); toast(`${fresh.length} prompts added`);
    } catch { toast('That is not a RUVET library export'); }
  } else if (a === 'remix' && item) {
    prefs.mode = 'variants'; prefs.targets = [item.target]; syncControls(); setView('studio');
    $('input').value = item.concept || item.positive; autosize(); $('input').focus();
  } else if (a === 'del' && item) {
    if (confirmTap('lib' + item.id)) { library = library.filter((x) => x !== item); saveLibrary(); renderNav(); }
    renderLibrary();
  }
});
$('memory').addEventListener('change', (e) => { const k = e.target.dataset.house; if (k) { memory.house[k] = e.target.value.trim(); saveMemory(); } });
$('memory').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-m]'), a = btn?.dataset.m; if (!a) return;
  const target = e.target.closest('[data-target]')?.dataset.target;
  try {
    if (a === 'style') await learnStyle();
    else if (a === 'learn') await learnLessons(target);
    else if (a === 'dellesson') { memory.lessons[target].splice(+btn.dataset.i, 1); saveMemory(); }
    else if (a === 'addlesson') { const v = e.target.closest('.panel').querySelector('[data-newlesson]').value.trim(); if (!v) return; (memory.lessons[target] ??= []).push(v); saveMemory(); }
    else if (a === 'delfb') { memory.feedback = memory.feedback.filter((f) => f.id !== btn.dataset.id); saveMemory(); }
    else if (a === 'clearledger') { if (confirmTap('ledger')) { memory.ledger = []; saveMemory(); } }
  } catch { toast('Could not read the answer; try again'); }
  renderMemory(); renderNav();
});

$('menuBtn').addEventListener('click', openDrawer);
$('scrim').addEventListener('click', closeDrawer);
$('newBtn').addEventListener('click', () => { if (running) return toast('Stop the current run first'); chat = newChat(); setView('studio'); renderThread(); renderChats(); if (desktop.matches) $('input').focus(); });
$('chats').addEventListener('click', async (e) => {
  const del = e.target.closest('[data-del]');
  if (del) {
    if (confirmTap('chat' + del.dataset.del)) {
      await idb('readwrite', (s) => s.delete(del.dataset.del)).catch(() => {});
      if (del.dataset.del === chat.id && !running) { chat = newChat(); renderThread(); }
    }
    return renderChats();
  }
  const open = e.target.closest('[data-id]'); if (!open) return;
  if (running) return toast('Stop the current run first');
  const c = await idb('readonly', (s) => s.get(open.dataset.id)).catch(() => null);
  if (c) { chat = c; setView('studio'); renderThread(); }
  closeDrawer(); renderChats();
});
$('setBtn').addEventListener('click', openSettings);
$('setForm').addEventListener('submit', (e) => {
  e.preventDefault();
  for (const f of backend.fields) cfg[f.id] = $('f-' + f.id).value.trim();
  store.set('ruvet.settings', cfg); $('settings').close(); toast('Saved');
  if (!chat.runs.length) renderThread();
});
$('settings').addEventListener('click', (e) => { if (e.target === $('settings')) $('settings').close(); });
$('wipeBtn').addEventListener('click', async () => {
  if (!confirmTap('wipe')) { $('wipeBtn').textContent = 'Sure? Chats, library, memory, settings'; return; }
  for (const k of ['settings', 'prefs', 'memory', 'library']) { try { localStorage.removeItem('ruvet.' + k); } catch { /* unavailable */ } }
  await idb('readwrite', (s) => s.clear()).catch(() => {});
  location.reload();
});

syncControls(); setView('studio'); renderThread(); renderChats();
if (desktop.matches) $('input').focus();
Promise.resolve(backend.init()).then((c) => { caps = c ?? caps; $('imgBtn').hidden = !caps.images; if (c?.off && !chat.runs.length) renderThread(); });
};
