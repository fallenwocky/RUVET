// Stress and abuse: hostile or broken replies, API failures, races, huge inputs, blocked storage,
// corrupt files and extreme viewports. Each test states the behaviour that must hold.
const { test, expect } = require('@playwright/test');
const { open, openWeb, compiles, critics, idle, toggleTarget, send, pngWithText } = require('./helpers');

const desktopOnly = ({ isMobile }) => isMobile;
const XSS = '<img src=x onerror="window.__xss=(window.__xss||0)+1"><script>window.__xss=1</script>';
// Counts what the hostile markup would have created if it were not escaped: <img src=x> elements and <script> tags carrying it.
const injected = (page) => page.evaluate(() => ({ ran: window.__xss ?? 0, imgs: document.querySelectorAll('img[src="x"]').length + [...document.scripts].filter((s) => s.textContent.includes('window.__xss=1')).length }));
const notBusy = (page) => expect(page.locator('body')).not.toHaveClass(/busy/);

for (const kind of ['web', 'artifact']) {
  test.describe(`${kind} · hostile and broken replies`, () => {
    test('markup in a reply, the critic, a review, sparks and saved names is never executed', async ({ page }) => {
      const hostile = `### 🎬 ${XSS}\n**Risk:** 4 (low)\n${XSS}\n- ${XSS}\n#### 🟢 Positive\n\`\`\`text\nA girl by a window, ${XSS}\n\`\`\`\n**Ledger:** L | ${XSS}`;
      const app = await open(kind, page, {
        override: (system) => {
          if (system.startsWith('# SAPPHIRE VISION')) return hostile;
          if (system.includes('SAPPHIRE CRITIC')) return `**Verdict:** FIX ${XSS}\n#### 🟢 Positive\n\`\`\`text\n${XSS}\n\`\`\``;
          if (system.startsWith('You invent')) return JSON.stringify([XSS, XSS, XSS]);
          if (system.startsWith('You review')) return JSON.stringify({ verdict: 'failed', issues: ['broken hands'], kept: [XSS], note: XSS });
          if (system.startsWith('You maintain')) return JSON.stringify([XSS]);
        },
      });
      await send(page, `Idea ${XSS}`, 1);
      await page.click('[data-act="save"]');
      await page.click('#sparkBtn'); await expect(page.locator('[data-idea]')).toHaveCount(3);
      await page.click('[data-close]');
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-act="review"]')]);
      await chooser.setFiles({ name: 'r.png', mimeType: 'image/png', buffer: pngWithText('x', 'y') });
      await expect(page.locator('.review')).toContainText('failed');
      await page.click('[data-view="kit"]');
      await page.fill('[data-form="chars"] [data-k="name"]', XSS); await page.click('[data-kit="save"][data-kind="chars"]');
      await page.click('[data-view="memory"]');
      await page.fill('#memory [data-newlesson]', XSS).catch(() => {});
      await page.click('[data-view="library"]');
      await page.click('[data-view="studio"]');
      await page.click('#optsBtn');
      expect(await injected(page)).toEqual({ ran: 0, imgs: 0 });
      expect(app.calls.length).toBeGreaterThan(2);
    });

    test('an empty reply ends the run and gives the text back instead of thinking forever', async ({ page }) => {
      await open(kind, page, { override: (system) => (system.startsWith('# SAPPHIRE VISION') ? (kind === 'web' ? { stop: 'end_turn', text: '' } : '') : undefined) });
      await page.fill('#input', 'An idea'); await page.click('#sendBtn');
      await notBusy(page);
      await expect(page.locator('.dots')).toHaveCount(0);
      await expect(page.locator('.run')).toHaveCount(0);
      await expect(page.locator('#input')).toHaveValue('An idea');
      await expect(page.locator('#toast')).toContainText('empty');
    });

    test('a reply with no prompt block, an unclosed block, or many variants still renders', async ({ page }) => {
      const replies = ['Just some prose, no blocks at all.', '#### 🟢 Positive\n```text\nan unclosed block, 1girl, solo', Array.from({ length: 6 }, (_, i) => `### Variant ${i + 1}\n#### 🟢 Positive\n\`\`\`text\nVariant ${i + 1}: a girl reading by a window in soft light.\n\`\`\``).join('\n')];
      let n = 0;
      await open(kind, page, { override: (system) => (system.startsWith('# SAPPHIRE VISION') ? replies[n++] : system.includes('SAPPHIRE CRITIC') ? '**Verdict:** ???' : undefined) });
      await send(page, 'one', 1);
      await expect(page.locator('.run').nth(0).locator('.pipe')).toHaveText(/^Compile$/);
      await send(page, 'two', 2);
      await expect(page.locator('.run').nth(1).locator('.code.pos code')).toContainText('an unclosed block');
      await send(page, 'three', 3);
      await expect(page.locator('.run').nth(2).locator('.sum')).toContainText('6 variants');
      await expect(page.locator('.run').nth(2).locator('.pipe')).toContainText('Critic · done');
    });

    test('garbage from the helper calls is reported, not thrown', async ({ page }) => {
      await open(kind, page, { override: (system) => (system.startsWith('You') ? 'definitely not json {' : undefined) });
      const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
      await page.click('#sparkBtn');
      await expect(page.locator('#toast')).toContainText('Could not read the ideas');
      await expect(page.locator('#sparks')).toBeHidden();
      await send(page, 'An idea', 1);
      await page.click('[data-act="failed"]'); await page.click('[data-issue="extra limbs"]'); await page.click('[data-act="fbsave"]');
      await page.click('[data-view="memory"]');
      await page.click('#memory [data-m="learn"]');
      await expect(page.locator('#toast')).toContainText('Could not read');
      await page.click('[data-view="studio"]');
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-act="review"]')]);
      await chooser.setFiles({ name: 'r.png', mimeType: 'image/png', buffer: pngWithText('x', 'y') });
      await expect(page.locator('#toast')).toContainText('Could not read the review');
      await expect(page.locator('.review')).toHaveCount(0);
      await notBusy(page);
      expect(errors).toEqual([]);
    });
  });

  test.describe(`${kind} · failures and races`, () => {
    test('a failure on the first call puts the text back; a failure on the critic keeps the result', async ({ page }) => {
      let n = 0;
      // 400 is not retried by the SDK, so each failure is exactly one call.
      const fail = kind === 'web' ? { status: 400, message: 'bad request' } : { code: 'upstream_error' };
      await open(kind, page, { override: (system) => { n++; if (n === 1) return fail; if (system.includes('SAPPHIRE CRITIC')) return fail; } });
      await page.fill('#input', 'An idea'); await page.click('#sendBtn');
      await notBusy(page);
      await expect(page.locator('.run')).toHaveCount(0);
      await expect(page.locator('#input')).toHaveValue('An idea');
      await page.click('#sendBtn'); await idle(page, 1);
      await expect(page.locator('.note')).toContainText('Critic step failed');
      await expect(page.locator('.code.pos')).toHaveCount(1);
    });

    test('refusals and cut-off replies are marked', async ({ page }) => {
      let n = 0;
      const outcomes = kind === 'web' ? [{ stop: 'refusal', text: '' }, { stop: 'max_tokens', text: '#### 🟢 Positive\n```text\nA girl by a window\n```' }] : [{ code: 'refused' }, { truncated: true, text: '#### 🟢 Positive\n```text\nA girl by a window\n```' }];
      await open(kind, page, { override: (system) => (system.startsWith('# SAPPHIRE VISION') ? outcomes[n++] : undefined) });
      await page.fill('#input', 'first'); await page.click('#sendBtn'); await notBusy(page);
      if (kind === 'web') await expect(page.locator('.run').first().locator('.note')).toContainText('Declined');
      else await expect(page.locator('#toast')).toContainText('declined');
      await send(page, 'second', kind === 'web' ? 2 : 1);
      await expect(page.locator('.run').last().locator('.note')).toContainText('cut short');
    });

    test('a double tap on send does not cancel the run it just started', async ({ page }) => {
      const app = await open(kind, page, { override: () => (kind === 'web' ? { delay: 400 } : undefined) });
      await page.fill('#input', 'An idea');
      await page.dblclick('#sendBtn');
      await idle(page, 1);
      await expect(page.locator('.code.pos')).toHaveCount(1);
      expect(compiles(app.calls)).toHaveLength(1);
    });

    test('stop during a slow reply ends cleanly and the next run works', async ({ page }) => {
      test.skip(kind === 'artifact', 'the mocked sample answers at once');
      await openWeb(page, { override: (system, user, n) => (n === 1 ? { delay: 3000 } : undefined) });
      await page.fill('#input', 'slow'); await page.click('#sendBtn');
      await page.waitForTimeout(900);
      await page.click('#sendBtn');
      await notBusy(page);
      await expect(page.locator('#input')).toHaveValue('slow');
      await send(page, 'fast', 1);
      await expect(page.locator('.code.pos')).toHaveCount(1);
    });

    test('switching views during a run does not lose the result', async ({ page }) => {
      await open(kind, page, { override: () => (kind === 'web' ? { delay: 250 } : undefined) });
      await toggleTarget(page, 'illustrious');
      await page.fill('#input', 'An idea'); await page.click('#sendBtn');
      for (const v of ['library', 'kit', 'memory', 'test', 'studio', 'memory', 'studio']) await page.click(`[data-view="${v}"]`);
      await idle(page, 1);
      await page.click('[data-tab="illustrious"]');
      await expect(page.locator('.pipe')).toContainText('Fix applied');
      await page.click('#newBtn');
      await expect(page.locator('.run')).toHaveCount(0);
    });

    test('stopping the test bench keeps the cases that finished', async ({ page }) => {
      test.skip(kind === 'artifact', 'the mocked sample answers at once');
      await openWeb(page, { override: (system, user, n) => (n >= 3 ? { delay: 2500 } : undefined) });
      await page.click('[data-view="test"]');
      await page.click('[data-b="run"]'); await page.click('[data-b="run"]');
      await expect(page.locator('#test .pill').first()).toContainText('1/8');
      await page.click('[data-b="stop"]');
      await notBusy(page);
      const runs = await page.evaluate(() => JSON.parse(localStorage.getItem('ruvet.bench')).runs);
      expect(runs).toHaveLength(1);
      expect(runs[0].cases.length).toBeGreaterThanOrEqual(1);
    });
  });

  test.describe(`${kind} · volume and hostile files`, () => {
    test.skip(desktopOnly, 'volume runs once');

    test('forty runs in one chat stay responsive and reopen from history', async ({ page }) => {
      test.setTimeout(120_000);
      const app = await open(kind, page);
      await page.click('#optsBtn'); await page.click('[data-toggle="full"]'); await page.click('#optsBtn');
      for (let i = 1; i <= 40; i++) await send(page, `Idea number ${i}`, i);
      const t0 = Date.now();
      await page.click('[data-view="library"]'); await page.click('[data-view="studio"]');
      expect(Date.now() - t0).toBeLessThan(3000);
      expect(critics(app.calls)).toHaveLength(0);
      if (kind === 'artifact') expect(app.calls.at(-1).turns).toBeLessThanOrEqual(81);
      await page.reload();
      await page.locator('#chats .open').first().click().catch(async () => { await page.click('#menuBtn'); await page.locator('#chats .open').first().click(); });
      await expect(page.locator('.run')).toHaveCount(40);
    });

    test('a library of 1500 prompts searches quickly', async ({ page }) => {
      await page.addInitScript(() => {
        if (localStorage.getItem('ruvet.library')) return;
        const lib = Array.from({ length: 1500 }, (_, i) => ({ id: 'x' + i, ts: Date.now() - i, title: `Prompt ${i} ${i % 7 === 0 ? 'lighthouse' : 'meadow'}`, target: 'illustrious', rating: 'general', concept: '', positive: `masterpiece, best quality, 1girl, solo, tag${i}, ${'filler, '.repeat(30)}`, negative: 'lowres' }));
        localStorage.setItem('ruvet.library', JSON.stringify(lib));
      });
      await open(kind, page);
      await page.click('[data-view="library"]');
      const t0 = Date.now();
      await page.fill('#libQ', 'lighthouse');
      await expect(page.locator('#library .item')).toHaveCount(215);
      expect(Date.now() - t0).toBeLessThan(4000);
    });

    test('a 200 KB idea and pathological markdown do not hang the page', async ({ page }) => {
      const nasty = '*a '.repeat(20000) + '`'.repeat(5000) + '**'.repeat(10000) + '(x:1.' .repeat(5000);
      await open(kind, page, { override: (system) => (system.startsWith('# SAPPHIRE VISION') ? `### ${nasty}\n${nasty}\n#### 🟢 Positive\n\`\`\`text\n${nasty}\n\`\`\`` : undefined) });
      const t0 = Date.now();
      await page.fill('#input', 'x'.repeat(200_000)); await page.click('#sendBtn');
      await notBusy(page);
      expect(Date.now() - t0).toBeLessThan(15_000);
      const lintMs = await page.evaluate((s) => { const t = performance.now(); window.RUVET_LINT('illustrious', s, s); window.RUVET_LINT('tsubaki3', s, s); return performance.now() - t; }, nasty);
      expect(lintMs).toBeLessThan(2000);
    });

    test('non-images, corrupt PNGs and a huge PNG text chunk are handled', async ({ page }) => {
      await open(kind, page);
      const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
      await page.setInputFiles('#file', { name: 'notes.png', mimeType: 'image/png', buffer: Buffer.from('this is not a png') });
      await expect(page.locator('#toast')).toContainText('Could not read the image');
      await expect(page.locator('#attach')).toBeHidden();
      const truncated = pngWithText('parameters', 'a, b').subarray(0, 60);
      await page.setInputFiles('#file', { name: 'cut.png', mimeType: 'image/png', buffer: truncated });
      // The image cannot be decoded, but its prompt chunk is complete, so the prompt is still read.
      await expect(page.locator('#input')).toHaveValue('positive: a, b');
      await expect(page.locator('#attach')).toBeHidden();
      await page.fill('#input', '');
      await page.setInputFiles('#file', { name: 'big.png', mimeType: 'image/png', buffer: pngWithText('parameters', 'tag, '.repeat(400_000)) });
      await expect(page.locator('#input')).toHaveValue(/^positive: tag, tag/);
      expect(errors).toEqual([]);
    });

    test('a hostile backup file cannot break the app', async ({ page }) => {
      await open(kind, page);
      // A JSON text, so "__proto__" arrives as an own key the way a crafted file would carry it.
      const bad = JSON.parse('{"app":"RUVET.","version":1,"chats":[{"id":"c1","title":"t","updated":1,"runs":"oops"},null,7,{"runs":[]}],"library":"nope","kit":{"chars":"zz","loras":[null]},"prefs":{"targets":"x","mode":42,"chars":null},"memory":{"house":null,"lessons":[],"feedback":"x","ledger":{},"__proto__":{"polluted":true}}}');
      const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
      await page.click('[data-view="memory"]');
      await page.click('[data-m="restore"]');
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-m="restore"]')]);
      await chooser.setFiles({ name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad)) });
      await expect(page.locator('#toast')).toContainText('Restored 0 chats, 0 prompts (4 unreadable chats skipped)');
      for (const v of ['studio', 'library', 'kit', 'memory', 'test', 'studio']) await page.click(`[data-view="${v}"]`);
      await page.click('#optsBtn'); await page.click('#optsBtn');
      await send(page, 'Still works', 1);
      expect(await page.evaluate(() => ({}).polluted)).toBeUndefined();
      expect(await injected(page)).toEqual({ ran: 0, imgs: 0 });
      expect(errors).toEqual([]);
    });

    test('garbage library imports are rejected', async ({ page }) => {
      await open(kind, page);
      await page.click('[data-view="library"]');
      for (const junk of ['not json', '{"a":1}', '[1,2,null]', '[{"positive":5}]', 'null']) {
        await page.click('[data-l="import"]').catch(() => {});
        if (await page.locator('#libImport').isHidden()) await page.click('[data-l="import"]');
        await page.fill('#libJson', junk);
        await page.click('[data-l="doimport"]');
        await expect(page.locator('#toast')).toBeVisible();
      }
      await expect(page.locator('#library .item')).toHaveCount(0);
    });
  });
}

test.describe('logic found by reading the code', () => {
  test('Enter while a run is going does not cancel it', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Enter sends only with a keyboard and mouse');
    const app = await openWeb(page, { override: () => ({ delay: 1500 }) });
    await page.fill('#input', 'first'); await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);
    await page.fill('#input', 'typing the next one'); await page.keyboard.press('Enter');
    await expect(page.locator('#toast')).toContainText('Still working');
    await idle(page, 1);
    await expect(page.locator('.code.pos')).toHaveCount(1);
    await expect(page.locator('#input')).toHaveValue('typing the next one');
    expect(compiles(app.calls)).toHaveLength(1);
  });

  test('a result has one verdict in memory however often it is marked', async ({ page }) => {
    await openWeb(page);
    await send(page, 'An idea', 1);
    await page.click('.actions [data-act="worked"]'); await page.click('.actions [data-act="worked"]');
    await page.click('.actions [data-act="failed"]'); await page.click('[data-issue="extra limbs"]'); await page.click('[data-act="fbsave"]');
    const fb = await page.evaluate(() => JSON.parse(localStorage.getItem('ruvet.memory')).feedback);
    expect(fb).toHaveLength(1);
    expect(fb[0]).toMatchObject({ verdict: 'failed', issues: ['extra limbs'] });
    const app2 = await page.evaluate(() => window.RUVET_TEST.state().chat.fb);
    expect(app2.tsubaki3).toHaveLength(1);
  });

  test('render feedback for another model stays queued when one model is repaired', async ({ page }) => {
    const app = await openWeb(page);
    await toggleTarget(page, 'illustrious');
    await send(page, 'An idea', 1);
    await page.click('.actions [data-act="worked"]');
    await page.click('[data-tab="illustrious"]');
    await page.click('.actions [data-act="failed"]'); await page.click('[data-issue="broken hands"]'); await page.click('[data-act="fbrepair"]');
    await page.click('#sendBtn'); await idle(page, 2);
    expect(compiles(app.calls).at(-1).user).toContain('failed on render: broken hands');
    await page.click('#optsBtn'); await page.click('#targets [data-target="tsubaki3"]'); await page.click('#targets [data-target="illustrious"]'); await page.click('#optsBtn');
    await page.click('[data-mode="generate"]');
    await send(page, 'Next for tsubaki', 3);
    expect(compiles(app.calls).at(-1).user).toContain('feedback: the previous output rendered well');
  });

  test('when the first model fails, the tab of one that answered is shown', async ({ page }) => {
    await openWeb(page, { override: (system, user) => (system.startsWith('# SAPPHIRE VISION') && user.includes('model: tsubaki3') ? { status: 400, message: 'no' } : undefined) });
    await toggleTarget(page, 'illustrious');
    await send(page, 'An idea', 1);
    await expect(page.locator('[data-tab="illustrious"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.code.pos').first()).toBeVisible();
  });

  test('a review that cannot be read keeps the earlier review', async ({ page }) => {
    let n = 0;
    await openWeb(page, { override: (system) => (system.startsWith('You review') && ++n === 2 ? 'not json' : undefined) });
    await send(page, 'An idea', 1);
    for (let i = 0; i < 2; i++) {
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('.actions [data-act="review"]')]);
      await chooser.setFiles({ name: 'r.png', mimeType: 'image/png', buffer: pngWithText('x', 'y') });
      await expect(page.locator('body')).not.toHaveClass(/busy/);
      await expect(page.locator('.review')).toContainText('Broke: broken hands');
    }
    await expect(page.locator('#toast')).toContainText('Could not read the review');
  });

  test('learned lessons that are not text are dropped; a stored setting outside its options resets', async ({ page }) => {
    await page.addInitScript(() => { if (!localStorage.getItem('ruvet.settings')) localStorage.setItem('ruvet.settings', JSON.stringify({ apiKey: 'sk-ant-test', model: 'not-a-model', effort: 7 })); });
    const app = await openWeb(page, { override: (system) => (system.startsWith('You maintain') ? JSON.stringify(['keep hands parked', { a: 1 }, 5, null, 'two\nlines <b>']) : undefined) });
    await send(page, 'An idea', 1);
    expect(app.calls[0].body.model).toBe('claude-opus-5-5');
    expect(app.calls[0].body.output_config.effort).toBe('medium');
    await page.click('.actions [data-act="worked"]');
    await page.click('[data-view="memory"]'); await page.click('#memory [data-m="learn"]');
    await expect(page.locator('#memory [data-m="dellesson"]')).toHaveCount(2);
    const lessons = await page.evaluate(() => JSON.parse(localStorage.getItem('ruvet.memory')).lessons.tsubaki3);
    expect(lessons).toEqual(['keep hands parked', 'two lines b']);
  });
});

test.describe('dangerous actions while a run is going', () => {
  test('the running step chip is styled as a chip, not as a result', async ({ page }) => {
    await openWeb(page, { override: () => ({ delay: 1500 }) });
    await page.fill('#input', 'An idea'); await page.click('#sendBtn');
    const chip = page.locator('.pipe .st.going');
    await expect(chip).toBeVisible();
    expect(await chip.evaluate((el) => getComputedStyle(el).marginBottom)).toBe('0px');
    await expect(page.locator('.pipe .run')).toHaveCount(0);
  });

  test('restore and deleting the open chat wait for the run', async ({ page }) => {
    let slow = false;
    await openWeb(page, { override: () => (slow ? { delay: 2500 } : undefined) });
    await send(page, 'First', 1);
    slow = true;
    await page.fill('#input', 'Second'); await page.click('#sendBtn');
    expect(await page.evaluate(() => window.RUVET_TEST.restoreData({ app: 'RUVET.', chats: [] }))).toBeUndefined();
    await expect(page.locator('#toast')).toContainText('Stop the current run first');
    await page.evaluate(() => document.querySelector('#chats [data-del]').click());
    await expect(page.locator('#toast')).toContainText('Stop the current run first');
    await idle(page, 2);
    await expect(page.locator('#chats .open')).toHaveCount(1);
  });
});

test.describe('how each API failure reads to the user', () => {
  const cases = [
    [{ status: 401, message: 'invalid x-api-key' }, 'Invalid API key'],
    [{ status: 403, message: 'forbidden' }, 'no access to the selected model'],
    [{ status: 404, message: 'model: x' }, 'Model not found'],
    [{ status: 400, message: 'prompt is too long' }, 'API error (400)'],
    [{ network: true }, 'Could not connect'],
  ];
  for (const [failure, text] of cases) test(`web: ${JSON.stringify(failure)}`, async ({ page }) => {
    test.setTimeout(60_000);
    await openWeb(page, { override: () => failure });
    await page.fill('#input', 'An idea'); await page.click('#sendBtn');
    await expect(page.locator('#toast')).toContainText(text, { timeout: 30_000 });
    await expect(page.locator('body')).not.toHaveClass(/busy/);
    await expect(page.locator('#input')).toHaveValue('An idea');
    await expect(page.locator('.run')).toHaveCount(0);
  });
  for (const [code, text] of [['not_granted', 'was not allowed'], ['rate_limited', 'Usage limit reached'], ['session_expired', 'sign in again'], ['prompt_too_large', 'too long'], ['some_new_code', 'Connection problem']]) test(`artifact: ${code}`, async ({ page }) => {
    await open('artifact', page, { override: () => ({ code }) });
    await page.fill('#input', 'An idea'); await page.click('#sendBtn');
    await expect(page.locator('#toast')).toContainText(text);
    await expect(page.locator('body')).not.toHaveClass(/busy/);
    await expect(page.locator('#input')).toHaveValue('An idea');
  });
});

test.describe('blocked storage and extreme screens', () => {
  test('the app loads and runs with localStorage throwing and no IndexedDB', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
      Object.defineProperty(window, 'indexedDB', { get() { return undefined; } });
    });
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await openWeb(page, { key: false });
    await page.click('.warnbox');
    await page.fill('#f-apiKey', 'sk-ant-test'); await page.click('#saveBtn');
    await send(page, 'An idea', 1);
    await expect(page.locator('.code.pos')).toHaveCount(1);
    for (const v of ['library', 'kit', 'memory', 'test', 'studio']) await page.click(`[data-view="${v}"]`);
    expect(errors).toEqual([]);
  });

  for (const [w, h] of [[320, 568], [568, 320], [2560, 1440]]) {
    test(`${w}×${h}: no sideways scrolling on any view`, async ({ page, isMobile }) => {
      test.skip(isMobile, 'viewport is set by hand');
      await page.setViewportSize({ width: w, height: h });
      // Tests block Google Fonts, so layout falls back to whatever the machine has. Force a wide fallback so the result does not depend on it.
      await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = ':root{--body:"DejaVu Sans",Verdana,sans-serif;--display:"DejaVu Sans",Verdana,sans-serif}'; document.head.append(s); }));
      await open('web', page);
      await toggleTarget(page, 'illustrious');
      await send(page, 'An old repairman fixing a carousel alone in a closed amusement park with a very long title to wrap', 1);
      await page.click('[data-tab="illustrious"]');
      for (const v of ['studio', 'library', 'kit', 'memory', 'test']) {
        await page.click(`[data-view="${v}"]`);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), v).toBeLessThanOrEqual(0);
      }
      await page.click('[data-view="studio"]'); await page.click('#optsBtn');
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
      const box = await page.locator('#sendBtn').boundingBox();
      expect(box.y + box.height).toBeLessThanOrEqual(h + 1);
    });
  }

  test('unicode everywhere: CJK, RTL and emoji survive the round trip', async ({ page }) => {
    const app = await openWeb(page);
    const text = '桜の下で 🌸 قطة على السطح — Ünlü kedi şapkalı';
    await send(page, text, 1);
    await expect(page.locator('.user .bubble')).toHaveText(text);
    expect(compiles(app.calls)[0].user).toContain(text);
    await page.click('[data-act="save"]');
    await page.click('[data-view="library"]');
    await expect(page.locator('#library .item h3')).toHaveText(text);
  });
});
