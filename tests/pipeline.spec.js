// The core loop: compile → lint → critic → fix, follow-ups, memory, library and sparks — on both versions.
const { test, expect } = require('@playwright/test');
const { open, openWeb, compiles, critics, idle, toggleTarget, send, SPARKS, LESSONS } = require('./helpers');

test('web app asks for an API key before the first run', async ({ page }) => {
  await openWeb(page, { key: false });
  await page.click('.warnbox');
  await expect(page.locator('#settings')).toBeVisible();
  await page.fill('#f-apiKey', 'sk-ant-test');
  await page.click('#saveBtn');
  await expect(page.locator('.warnbox')).toHaveCount(0);
});

for (const kind of ['web', 'artifact']) {
  test.describe(kind, () => {
    let app;
    test.beforeEach(async ({ page }) => { app = await open(kind, page); });

    test('compiles one idea for two models, lints, audits and applies the fix', async ({ page }) => {
      await toggleTarget(page, 'illustrious');
      await send(page, 'An old repairman fixing a carousel', 1);

      await expect(page.locator('.pipe')).toHaveText(/Compile.*Lint · clean.*Critic · PASS/);
      await page.click('[data-tab="illustrious"]');
      await expect(page.locator('.pipe')).toHaveText(/Compile.*Critic · FIX.*Fix applied/);
      await expect(page.locator('.final code').first()).not.toContainText('perfect hands');
      await expect(page.locator('.sum')).toContainText('dialect clean');

      const c = compiles(app.calls);
      expect(c).toHaveLength(2);
      expect(critics(app.calls)).toHaveLength(2);
      // The critic is told what was asked for, so it can catch a dropped element.
      for (const k of critics(app.calls)) expect(k.user).toContain('<request>\nAn old repairman fixing a carousel\n</request>');
      const tsubaki = c.find((x) => x.user.includes('model: tsubaki3')), tag = c.find((x) => x.user.includes('model: illustrious'));
      expect(tsubaki.system).toContain('TSUBAKI BUILD');
      expect(tsubaki.system).toContain('<pack id="DESCRIPTION"');
      expect(tsubaki.system).not.toContain('<pack id="TAG"');
      expect(tag.system).toContain('<booru_shared>');
      expect(tag.system).toContain('<pack id="TAG"');
    });

    test('carries the critic correction and the render result into the follow-up', async ({ page }) => {
      await toggleTarget(page, 'illustrious');
      await send(page, 'An old repairman fixing a carousel', 1);
      await page.click('[data-tab="illustrious"]');
      await page.click('[data-act="failed"]');
      await page.click('[data-issue="broken hands"]');
      await page.fill('#fbNote', 'wrench melted');
      await page.click('[data-act="fbsave"]');
      await send(page, 'Make it dusk', 2);

      const follow = compiles(app.calls).find((x) => x.turns === 3 && x.user.includes('model: illustrious'));
      expect(follow.user).toContain('feedback: an auditor corrected the previous output');
      expect(follow.user).toContain('failed on render: broken hands — wrench melted');
      const other = compiles(app.calls).find((x) => x.turns === 3 && x.user.includes('model: tsubaki3'));
      expect(other.user).not.toContain('failed on render');
    });

    test('learns lessons from results and gives the next chat its memory', async ({ page }) => {
      await toggleTarget(page, 'illustrious');
      await toggleTarget(page, 'tsubaki3');
      await send(page, 'An old repairman fixing a carousel', 1);
      await page.click('[data-act="failed"]');
      await page.click('[data-issue="broken hands"]');
      await page.click('[data-act="fbsave"]');

      await page.click('[data-view="memory"]');
      await page.click('#memory [data-target="illustrious"] [data-m="learn"]');
      await expect(page.locator('#memory [data-m="dellesson"]')).toHaveCount(2);

      await page.click('#newBtn');
      await send(page, 'A second idea', 1);
      const system = compiles(app.calls).at(-1).system;
      expect(system).toContain('\n<memory>\nmodel: illustrious\nlessons:');
      for (const l of LESSONS) expect(system).toContain(l);
      expect(system).toContain('- failed (broken hands)');
      expect(system).toContain('ledger:\nL | literal');
    });

    test('saves to the library, searches it and remixes an entry', async ({ page }) => {
      await send(page, 'An old repairman fixing a carousel', 1);
      await page.click('[data-act="save"]');
      await page.click('[data-view="library"]');
      await expect(page.locator('#library .item')).toHaveCount(1);
      await page.fill('#libQ', 'nothing like this');
      await expect(page.locator('#library .none')).toHaveText('Nothing matches.');
      await page.fill('#libQ', 'carousel');
      await expect(page.locator('#library .item')).toHaveCount(1);
      await page.click('[data-l="remix"]');
      await expect(page.locator('[data-mode="variants"]')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('#input')).toHaveValue('An old repairman fixing a carousel');
    });

    test('Settings says which version this is', async ({ page }) => {
      await page.click('#setBtn');
      await expect(page.locator('#settings .about')).toContainText(kind === 'web' ? 'Web app — calls the Claude API with your own Anthropic API key' : 'Claude artifact — runs on your own Claude account; no API key');
    });

    test('sparks five ideas and puts the chosen one in the composer', async ({ page }) => {
      await page.click('#sparkBtn');
      await expect(page.locator('[data-idea]')).toHaveCount(5);
      await page.click('[data-idea] >> nth=1');
      await expect(page.locator('#input')).toHaveValue(SPARKS[1]);
    });

    test('never scrolls the page sideways', async ({ page }) => {
      await toggleTarget(page, 'illustrious');
      await send(page, 'An old repairman fixing a carousel', 1);
      for (const v of ['studio', 'library', 'kit', 'memory', 'test']) {
        await page.click(`[data-view="${v}"]`);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
      expect(await page.evaluate(() => { const s = document.getElementById('views'); return s.scrollWidth <= s.clientWidth + 1; })).toBe(true);
    });
  });
}
