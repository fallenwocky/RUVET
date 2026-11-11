// The platform around the app: offline start, the service worker's file list, keyboard and screen-reader access,
// storage that refuses writes, long sessions, and whether the docs still describe the code.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { ROOT, open, openWeb, openArtifact, compiles, idle, toggleTarget, send, pngWithText } = require('./helpers');

const docs = path.join(ROOT, 'docs');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

test.describe('service worker', () => {
  test('its file list is exactly the files the web app is made of', () => {
    const sw = fs.readFileSync(path.join(docs, 'sw.js'), 'utf8');
    const listed = new Set(eval(sw.slice(sw.indexOf('['), sw.indexOf('];') + 1)).filter((f) => f !== './'));
    const actual = new Set(walk(docs).map((f) => path.relative(docs, f).split(path.sep).join('/')).filter((f) => f !== 'sw.js'));
    expect([...listed].sort()).toEqual([...actual].sort());
  });

  test.describe('offline', () => {
    test.use({ serviceWorkers: 'allow' });
    test('the installed app starts and compiles with no network for its own files', async ({ page, context, isMobile }) => {
      test.skip(isMobile, 'one run is enough');
      const app = await openWeb(page);
      await page.evaluate(() => navigator.serviceWorker.ready);
      await expect.poll(() => page.evaluate(() => caches.keys().then((k) => k.length))).toBeGreaterThan(0);
      await expect.poll(() => page.evaluate(async () => (await (await caches.open((await caches.keys())[0])).keys()).length)).toBeGreaterThanOrEqual(16);
      // Own files now fail on the network; only the cache can serve them.
      await context.route((url) => url.origin === 'http://localhost:8765', (r) => r.abort('internetdisconnected'));
      await page.reload();
      await expect(page.locator('#modes .chip').first()).toBeVisible();
      await send(page, 'Offline idea', 1);
      expect(compiles(app.calls).at(-1).system).toContain('<economy>');
    });
  });
});

for (const kind of ['web', 'artifact']) {
  test.describe(`${kind} · keyboard and screen readers`, () => {
    test('every control has a name on every view', async ({ page }) => {
      await open(kind, page);
      await page.click('[data-view="kit"]');
      await page.fill('[data-form="chars"] [data-k="name"]', 'Mira'); await page.click('[data-kit="save"][data-kind="chars"]');
      await page.click('[data-view="studio"]');
      await toggleTarget(page, 'illustrious');
      await send(page, 'An idea', 1);
      await page.click('.actions [data-act="save"]'); await page.click('.actions [data-act="failed"]');
      await page.click('#optsBtn');
      const unnamed = [];
      for (const v of ['studio', 'library', 'kit', 'memory', 'test']) {
        await page.click(`[data-view="${v}"]`);
        unnamed.push(...await page.evaluate((v) => [...document.querySelectorAll('button, [role="button"], input:not([type="file"]), select, textarea')].filter((el) => el.offsetParent !== null).filter((el) => {
          const name = el.getAttribute('aria-label') || el.labels?.[0]?.textContent.trim() || el.textContent.trim() || el.title;
          return !name;
        }).map((el) => `${v}: <${el.tagName.toLowerCase()} id="${el.id}" class="${el.className}">`), v));
      }
      await page.click('#setBtn');
      unnamed.push(...await page.evaluate(() => [...document.querySelectorAll('#settings input, #settings select, #settings button')].filter((el) => !(el.getAttribute('aria-label') || el.labels?.[0]?.textContent.trim() || el.textContent.trim())).map((el) => `settings: ${el.id}`)));
      expect(unnamed).toEqual([]);
    });

    test('label buttons work from the keyboard', async ({ page }) => {
      // Listening from the start keeps file-chooser interception on; arming it in the same tick as a key press can miss the dialog.
      const choosers = []; page.on('filechooser', (c) => choosers.push(c));
      await open(kind, page);
      await page.focus('#imgBtn');
      await page.keyboard.press('Enter');
      await expect.poll(() => choosers.length).toBe(1);
      await choosers[0].setFiles({ name: 'p.png', mimeType: 'image/png', buffer: pngWithText('x', 'y') });
      await expect(page.locator('#attach')).toBeVisible();
      await page.click('#attachDel');
      await send(page, 'An idea', 1);
      await page.focus('.actions [data-act="review"]');
      await page.keyboard.press('Space');
      await expect.poll(() => choosers.length).toBe(2);
      await choosers[1].setFiles({ name: 'r.png', mimeType: 'image/png', buffer: pngWithText('x', 'y') });
      await expect(page.locator('.review')).toContainText('failed');
    });

    test('the closed history drawer is out of reach on a phone, and Escape closes it', async ({ page, isMobile }) => {
      await open(kind, page);
      await send(page, 'An idea', 1);
      expect(await page.evaluate(() => document.getElementById('drawer').inert)).toBe(isMobile);
      if (!isMobile) return;
      await page.click('#menuBtn');
      await expect(page.locator('#drawer')).toHaveClass(/open/);
      expect(await page.evaluate(() => document.getElementById('drawer').inert)).toBe(false);
      await expect(page.locator('#chats .open')).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(page.locator('#drawer')).not.toHaveClass(/open/);
      await expect(page.locator('#menuBtn')).toBeFocused();
      expect(await page.evaluate(() => document.getElementById('drawer').inert)).toBe(true);
    });
  });
}

test.describe('storage that refuses writes', () => {
  test('a chat that cannot be saved is reported once and the app keeps working', async ({ page }) => {
    await page.addInitScript(() => { IDBObjectStore.prototype.put = function () { throw new DOMException('quota', 'QuotaExceededError'); }; });
    await openWeb(page);
    const toasts = [];
    await page.exposeFunction('__toast', (t) => toasts.push(t));
    await page.evaluate(() => new MutationObserver(() => { const t = document.getElementById('toast'); if (!t.hidden) window.__toast(t.textContent); }).observe(document.getElementById('toast'), { childList: true, attributes: true, characterData: true, subtree: true }));
    await send(page, 'One', 1); await send(page, 'Two', 2);
    await expect.poll(() => toasts.some((t) => t.includes('not saving'))).toBe(true);
    expect(new Set(toasts.filter((t) => t.includes('not saving'))).size).toBe(1);
    await expect(page.locator('.code.pos')).toHaveCount(2);
  });
});

test.describe('long sessions stay bounded', () => {
  test('memory keeps the newest 200 results and 6 ledger lines', async ({ page }) => {
    await page.addInitScript(() => {
      if (localStorage.getItem('ruvet.memory')) return;
      localStorage.setItem('ruvet.memory', JSON.stringify({ feedback: Array.from({ length: 260 }, (_, i) => ({ id: 'f' + i, ts: i, target: 'tsubaki3', verdict: 'worked', issues: [], note: 'n' + i })), ledger: Array.from({ length: 30 }, (_, i) => 'L | line ' + i), lessons: { tsubaki3: Array.from({ length: 50 }, (_, i) => 'lesson ' + i) } }));
    });
    const app = await openWeb(page);
    await send(page, 'An idea', 1);
    await page.click('.actions [data-act="worked"]');
    const m = await page.evaluate(() => JSON.parse(localStorage.getItem('ruvet.memory')));
    expect(m.feedback).toHaveLength(200);
    expect(m.feedback.at(-2).note).toBe('n259');
    expect(m.ledger.length).toBeLessThanOrEqual(6);
    expect(m.lessons.tsubaki3).toHaveLength(20);
    const mem = compiles(app.calls)[0].system; const block = mem.slice(mem.indexOf('\n<memory>'));
    expect(block.length).toBeLessThan(12000);
    expect(block.match(/^- worked/gm)).toHaveLength(8);
  });

  test('the artifact drops the oldest turns once history passes its size limit', async ({ page, isMobile }) => {
    test.skip(isMobile, 'one run is enough');
    test.setTimeout(90_000);
    const app = await openArtifact(page);
    await page.click('#optsBtn'); await page.click('[data-toggle="full"]'); await page.click('#optsBtn');
    for (let i = 1; i <= 9; i++) await send(page, `Idea ${i} ` + 'x'.repeat(30000), i);
    const last = app.calls.at(-1);
    expect(last.turns % 2).toBe(1);
    expect(last.turns).toBeLessThan(17);
    expect(last.user).toContain('Idea 9');
  });

  test('one message too long for the artifact says so', async ({ page }) => {
    await openArtifact(page, { override: () => ({ code: 'prompt_too_large' }) });
    await page.fill('#input', 'x'.repeat(1000)); await page.click('#sendBtn');
    await expect(page.locator('#toast')).toContainText('too long for this view');
  });
});

test.describe('two tabs', () => {
  test('both writing the same chat keep each other\'s results', async ({ page, context }) => {
    await openWeb(page);
    await send(page, 'From tab A, first', 1);
    const b = await context.newPage();
    await openWeb(b);
    await expect(b.locator('#chats .open').first()).toBeAttached();
    await b.evaluate(() => document.querySelector('#chats .open').click());
    await expect(b.locator('#thread > .run')).toHaveCount(1);
    await send(b, 'From tab B', 2);
    await send(page, 'From tab A, second', 3);
    await expect(page.locator('#toast')).toContainText('another tab');
    await expect(page.locator('#thread > .run .user .bubble')).toHaveText(['From tab A, first', 'From tab B', 'From tab A, second']);
    await b.reload();
    await expect(b.locator('#chats .open').first()).toBeAttached();
    await b.evaluate(() => document.querySelector('#chats .open').click());
    await expect(b.locator('#thread > .run')).toHaveCount(3);
    await expect(b.locator('#chats .open')).toHaveCount(1);
  });

  test('memory, library and kit changes reach the other tab', async ({ page, context }) => {
    await openWeb(page);
    const b = await context.newPage();
    await openWeb(b);
    await send(page, 'An idea', 1);
    await page.click('.actions [data-act="worked"]'); await page.click('.actions [data-act="save"]');
    await page.click('[data-view="kit"]'); await page.fill('[data-form="chars"] [data-k="name"]', 'Mira'); await page.click('[data-kit="save"][data-kind="chars"]');
    await expect.poll(() => b.evaluate(() => { const s = window.RUVET_TEST.state(); return [s.memory.feedback.length, s.library.length, s.kit.chars.length]; })).toEqual([1, 1, 1]);
    await expect(b.locator('[data-view="library"]')).toContainText('1');
    await expect(b.locator('#chats .open')).toHaveCount(1);
    // Tab B now saves something of its own: it must not drop what tab A added.
    await send(b, 'From B', 1); await b.click('.actions [data-act="save"]');
    expect(await b.evaluate(() => JSON.parse(localStorage.getItem('ruvet.library')).length)).toBe(1); // same prompt text: already in the library, not duplicated
    expect(await b.evaluate(() => JSON.parse(localStorage.getItem('ruvet.memory')).feedback.length)).toBe(1);
  });
});

test('the API request replays history exactly: image, raw content, cached system', async ({ page, isMobile }) => {
  test.skip(isMobile, 'one run is enough');
  const app = await openWeb(page);
  await page.setInputFiles('#file', { name: 'p.png', mimeType: 'image/png', buffer: pngWithText('x', 'y') });
  await send(page, 'First, with an image', 1);
  await send(page, 'Second', 2);
  const body = compiles(app.calls).at(-1).body;
  expect(body.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  expect(body.messages[0].content.map((c) => c.type)).toEqual(['image', 'text']);
  expect(body.messages[0].content[0].source).toMatchObject({ type: 'base64', media_type: 'image/jpeg' });
  expect(body.messages[1].content.map((c) => c.type)).toEqual(['thinking', 'text']);
  expect(body.messages[1].content[0].signature).toBe('sig-test');
  expect(body.messages[2].content.map((c) => c.type)).toEqual(['text']);
  expect(body.system).toHaveLength(1);
  expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' });
  expect(body.system[0].text).toBe(compiles(app.calls)[0].body.system[0].text);
  expect(body).toMatchObject({ model: 'claude-opus-5-5', thinking: { type: 'adaptive' }, output_config: { effort: 'medium' }, fallbacks: 'default' });
  // After a reload the stored chat must still replay the same content.
  await page.reload();
  await expect(page.locator('#chats .open').first()).toBeAttached();
  await page.evaluate(() => document.querySelector('#chats .open').click());
  await send(page, 'Third', 3);
  const again = compiles(app.calls).at(-1).body;
  expect(again.messages.slice(0, 3)).toEqual(body.messages);
});

test('a failed case in the test bench is recorded and the run goes on', async ({ page }) => {
  let n = 0;
  await openWeb(page, { override: (system) => (system.startsWith('# SAPPHIRE VISION') && ++n === 1 ? { status: 400, message: 'bad' } : undefined) });
  await page.click('[data-view="test"]');
  await page.fill('#benchIdeas', 'one\ntwo'); await page.locator('#benchIdeas').blur();
  await page.click('[data-b="run"]'); await page.click('[data-b="run"]');
  const row = page.locator('#test .panel table').first().locator('tbody tr');
  await expect(page.locator('body')).not.toHaveClass(/busy/, { timeout: 20000 });
  await expect(row).toContainText('1/2');
  await page.locator('#test details.sec summary').first().click();
  await expect(page.locator('#test .case .pill.bad')).toContainText('API error (400)');
});

test.describe('the docs still describe the code', () => {
  test.skip(({ isMobile }) => isMobile, 'file checks');
  const md = ['README.md', 'CONTRIBUTING.md', 'CLAUDE.md', 'CHANGELOG.md'].map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const app = fs.readFileSync(path.join(docs, 'app.js'), 'utf8');

  test('every npm script named in the docs exists', () => {
    for (const [f, text] of md) for (const m of text.matchAll(/npm run ([a-z:]+)/g)) expect(pkg.scripts, `${f}: npm run ${m[1]}`).toHaveProperty([m[1]]);
  });
  test('every repo path named in the docs exists', () => {
    const missing = [];
    for (const [f, text] of md.filter(([f]) => f !== 'CHANGELOG.md')) for (const m of text.matchAll(/`((?:docs|artifact|tests|tools|screenshots|\.github)\/[A-Za-z0-9_./-]*)`/g)) if (!fs.existsSync(path.join(ROOT, m[1]))) missing.push(`${f}: ${m[1]}`);
    expect(missing).toEqual([]);
  });
  test('the README names every target model and mode the app offers', () => {
    const readme = md[0][1];
    for (const m of app.matchAll(/\{ id: '[^']+', label: '([^']+)', build:/g)) expect(readme, m[1]).toContain(m[1]);
    for (const mode of ['auto', 'generate', 'variants', 'audit', 'repair', 'image', 'discuss']) expect(readme).toContain(mode);
    for (const img of readme.matchAll(/src="(screenshots\/[^"]+)"/g)) expect(fs.existsSync(path.join(ROOT, img[1])), img[1]).toBe(true);
  });
  test('the changelog version matches package.json', () => {
    expect(md[3][1]).toContain(`## ${pkg.version} —`);
  });
});
