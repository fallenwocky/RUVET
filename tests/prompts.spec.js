// The prompt system's files: every build part exists, and the rules the app relies on are present.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { ROOT } = require('./helpers');

test.skip(({ isMobile }) => isMobile, 'file checks: one project is enough');

const dir = path.join(ROOT, 'docs', 'prompts', 'sapphire');
const read = (n) => fs.readFileSync(path.join(dir, `${n}.txt`), 'utf8');

test('every part named in BUILDS exists, and nothing else is in the folder', () => {
  const app = fs.readFileSync(path.join(ROOT, 'docs', 'app.js'), 'utf8');
  const named = new Set([...app.matchAll(/parts: \[([^\]]+)\]/g)].flatMap((m) => m[1].match(/'([a-z_]+)'/g).map((s) => s.slice(1, -1))));
  named.add('critic');
  const files = new Set(fs.readdirSync(dir).filter((f) => f.endsWith('.txt')).map((f) => f.slice(0, -4)));
  expect([...named].sort()).toEqual([...files].sort());
});

test('the core carries the rules the app depends on', () => {
  const core = read('core');
  for (const tag of ['<laws>', '<memory_rules>', '<input_contract>', '<economy>', '<diversity>', '<output_contract>', '<self_check>']) expect(core).toContain(tag);
  expect(core).toContain('#### 🟢 Positive');
  expect(core).toContain('#### 🔴 Negative');
  expect(core).toContain('**Ledger:** L |');
  expect(core).toContain('every report field and message in English');
});

test('each model pack has a contrast example and a demo', () => {
  for (const p of ['description', 'tag', 'hybrid']) {
    const t = read(p);
    expect(t, p).toMatch(/^<pack id="/);
    expect(t, p).toContain('CONTRAST');
    expect(t, p).toContain('DEMO');
    expect(t.trim(), p).toMatch(/<\/pack>$/);
  }
  expect(read('description')).toContain('MODEL NOTES');
});

test('the critic audits economy and answers with a verdict the app can read', () => {
  const c = read('critic');
  expect(c).toContain('10 ECONOMY');
  expect(c).toContain('**Verdict:** PASS | FIX | REJECT');
});

test('the core and the critic hold the user\'s stated elements above fixes and bans', () => {
  const part = (n) => fs.readFileSync(path.join(__dirname, '..', 'docs', 'prompts', 'sapphire', n + '.txt'), 'utf8');
  const core = part('core'), critic = part('critic');
  expect(core).toMatch(/P1 FIDELITY[^\n]*Every stated element is in the prompt/);
  expect(core).toMatch(/A fix never crops out, turns away or parks a stated element/);
  expect(core).toMatch(/Banned unless motivated, DNA or stated by the user/);
  expect(core).toMatch(/M3 — no new scene: the corrected prompt contains nothing the original did not/);
  expect(critic).toMatch(/0 FIDELITY \(only with a User's request\)/);
});
