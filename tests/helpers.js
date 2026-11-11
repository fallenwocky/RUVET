// Shared fixtures: a mocked Claude for both backends, so the tests run offline and cost nothing.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { expect } = require('@playwright/test');

const ROOT = path.join(__dirname, '..');
const DESCRIPTION_MODELS = ['tsubaki3', 'flux', 'qwen-image', 'gpt-image', 'midjourney'];

const LEDGER = 'L | literal | mid-thigh | side | crouch | held | urban | lantern | night-clear | amber | watercolour | absence | none';
const TAG_FIXED = 'masterpiece, best quality, absurdres, general, 1boy, solo, retro artstyle, cowboy shot, from side, old man, grey hair, green jumpsuit, kneeling, holding wrench, carousel, night, lantern, orange theme';
const fence = (head, body) => `#### ${head}\n\`\`\`text\n${body}\n\`\`\``;

// A compiled result per model family. The tag version carries two planted faults
// (an anatomy pseudo-term and a negative that contradicts the positive) for the critic to fix.
function compileReply(model) {
  const desc = DESCRIPTION_MODELS.includes(model);
  const pos = desc
    ? 'An old repairman in a faded green boiler suit kneels beside a carousel horse, a wrench in his right hand, his left hand flat on the horse. A lantern on the platform throws warm light from below. Framed from mid-thigh up at eye level. Watercolour, visible paper grain. No text.'
    : `${TAG_FIXED}, perfect hands, crowd`;
  const neg = desc ? 'platform default + extra fingers' : 'lowres, worst quality, bad hands, crowd, text';
  return `### 🎬 Carousel Repairman\n**Setup:** ${model} · 2:3 · general · pose lock off\n**Risk:** 4 (low) · no fix\n**Scan:** cliché none · uncertain none · notes none\n${fence('🟢 Positive', pos)}\n${fence('🔴 Negative', neg)}\n**Render:** defaults · check hands\n**Ledger:** ${LEDGER}`;
}
function criticReply(model) {
  if (DESCRIPTION_MODELS.includes(model)) return '**Verdict:** PASS\n**Findings:** none';
  return `**Verdict:** FIX\n**Findings:**\n1. [HIGH] validity → "perfect hands" → remove\n2. [HIGH] positive ↔ negative → "crowd" → remove from the positive\n${fence('🟢 Positive', TAG_FIXED)}\n${fence('🔴 Negative', 'lowres, worst quality, bad hands, crowd, text')}`;
}
const SPARKS = ['A lighthouse keeper feeding gulls inside a flooded lamp room at dawn', 'A girl asleep on a bus full of potted ferns', 'A tailor measuring a scarecrow in a wheat field', 'A diver reading mail on a pier', 'A cat on a cold radiator in an empty classroom'];
const LESSONS = ['Park both hands in full-body shots', 'Keep backgrounds to two elements at night'];

function reply(system, user) {
  if (system.includes('SAPPHIRE CRITIC')) return criticReply((user.match(/Target model: (\S+)/) || [])[1]);
  if (system.startsWith('You invent picture ideas')) return JSON.stringify(SPARKS);
  if (system.startsWith('You maintain calibration')) return JSON.stringify(LESSONS);
  if (system.startsWith('You infer a person')) return JSON.stringify({ palette: 'cold blues', motifs: 'rain', banned: '', signature: '' });
  if (system.startsWith('You review a rendered image')) return JSON.stringify({ verdict: 'failed', issues: ['broken hands', 'not a real issue'], kept: ['lighting', 'scarf'], note: 'Park the left hand; the grip on the rail fused.' });
  return compileReply((user.match(/model: (\S+)/) || [])[1] || 'tsubaki3');
}

function sse(text, stop = 'end_turn') {
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  return ev('message_start', { message: { id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, usage: { input_tokens: 1200, cache_read_input_tokens: 9000, output_tokens: 1 } } })
    + ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
    + ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text } })
    + ev('content_block_stop', { index: 0 })
    + ev('message_delta', { delta: { stop_reason: stop }, usage: { output_tokens: 640 } })
    + ev('message_stop', {});
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

// `override(system, user, n)` may replace a reply: a string, or { status, message } for an HTTP error,
// { network: true } for a failed connection, { stop, text } for a refusal / max_tokens, { delay } to stall first.
// The web app (docs/) with the Claude API mocked. `calls` records every request.
async function openWeb(page, { key = true, override } = {}) {
  const calls = [];
  await page.route('https://fonts.googleapis.com/**', (r) => r.abort());
  await page.route('https://api.anthropic.com/**', async (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const body = JSON.parse(r.request().postData());
    const last = body.messages.at(-1).content;
    const user = typeof last === 'string' ? last : last.filter((c) => c.type === 'text').map((c) => c.text).join('');
    const system = body.system[0].text;
    calls.push({ system, user, turns: body.messages.length, image: Array.isArray(last) && last.some((c) => c.type === 'image'), body });
    let o = override?.(system, user, calls.length);
    if (o?.delay) await new Promise((res) => setTimeout(res, o.delay));
    if (o?.delay) o = o.then;
    if (o?.network) return r.abort('failed');
    if (o?.status) return r.fulfill({ status: o.status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'error', error: { type: 'api_error', message: o.message ?? 'mock error' } }) });
    const text = typeof o === 'string' ? o : o?.stop ? o.text ?? '' : reply(system, user);
    return r.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: sse(text, o?.stop ?? 'end_turn') }).catch(() => {});
  });
  if (key) await page.addInitScript(() => { if (!localStorage.getItem('ruvet.settings')) localStorage.setItem('ruvet.settings', JSON.stringify({ apiKey: 'sk-ant-test' })); });
  await page.goto('/');
  return { kind: 'web', calls };
}

// The single-file artifact (artifact/ruvet.html) with the viewer's Claude (`sample`) and `downloads` mocked.
// `override` as for openWeb, except errors are { code } (the sample capability's error codes) and { truncated, text }.
async function openArtifact(page, { override, images = true } = {}) {
  const calls = [], saved = [];
  const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>body{margin:0}[hidden]{display:none!important}</style></head><body>'
    + fs.readFileSync(path.join(ROOT, 'artifact', 'ruvet.html'), 'utf8') + '</body></html>';
  await page.route('**/*', (r) => (r.request().url().startsWith('https://artifact.test/') ? r.fulfill({ contentType: 'text/html', body: html }) : r.abort()));
  await page.exposeFunction('__ruvetReply', (input, image) => {
    const first = input[0].content, system = first.slice(first.indexOf('\n\n') + 2), user = input.at(-1).content;
    calls.push({ system, user, turns: input.length - 1, image });
    const o = override?.(system, user, calls.length);
    if (o?.code) return { __err: o.code };
    if (o?.truncated) return { __trunc: o.text };
    return typeof o === 'string' ? o : reply(system, user);
  });
  await page.exposeFunction('__ruvetSave', (filename, data) => { saved.push({ filename, data }); });
  await page.addInitScript((images) => {
    const sample = async (input, o) => {
      const r = await window.__ruvetReply(input, !!o.images);
      if (r && r.__err) throw { code: r.__err, message: 'mock' };
      const text = r && r.__trunc !== undefined ? r.__trunc : r, truncated = !!(r && r.__trunc !== undefined);
      if (!text) throw { code: 'empty_completion', message: 'mock' };
      o.onText({ text, delta: text }); return { text, truncated };
    };
    sample.limits = async () => (images ? { maxPromptBytes: 262144, images: { maxCount: 1, maxInputBytes: 20e6, mediaTypes: ['image/jpeg', 'image/png'] } } : { maxPromptBytes: 262144 });
    const downloads = { save: async (r) => { await window.__ruvetSave(r.filename, String(r.data)); return {}; } };
    window.claude = { use: async (name) => (name === 'sample' ? sample : name === 'downloads' ? downloads : null) };
  }, images);
  await page.goto('https://artifact.test/');
  return { kind: 'artifact', calls, saved };
}

const open = (kind, page, opts) => (kind === 'web' ? openWeb(page, opts) : openArtifact(page, opts));
const compiles = (calls) => calls.filter((c) => c.system.startsWith('# SAPPHIRE VISION ARCHITECT'));
const critics = (calls) => calls.filter((c) => c.system.includes('SAPPHIRE CRITIC'));

async function idle(page, runs) {
  await expect(page.locator('body')).not.toHaveClass(/busy/, { timeout: 20_000 });
  await expect(page.locator('#thread > .run')).toHaveCount(runs);
}
async function toggleTarget(page, id) {
  await page.click('#optsBtn');
  await page.click(`#targets [data-target="${id}"]`);
  await page.click('#optsBtn');
}
async function send(page, text, runs) {
  await page.fill('#input', text);
  await page.click('#sendBtn');
  await idle(page, runs);
}

// A PNG with one tEXt chunk, as A1111 / Forge (`parameters`) or ComfyUI (`prompt`) write it.
function pngWithText(key, value) {
  const png = fs.readFileSync(path.join(ROOT, 'docs', 'icons', 'icon-192.png'));
  const data = Buffer.concat([Buffer.from(key, 'latin1'), Buffer.from([0]), Buffer.from(value, 'latin1')]);
  const type = Buffer.from('tEXt'), len = Buffer.alloc(4), crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([type, data])) >>> 0);
  return Buffer.concat([png.subarray(0, 33), len, type, data, crc, png.subarray(33)]);
}

module.exports = { reply, ROOT, open, openWeb, openArtifact, compiles, critics, idle, toggleTarget, send, pngWithText, SPARKS, LESSONS, TAG_FIXED };
