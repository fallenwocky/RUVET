// Free local check, token usage and the test bench.
const { test, expect } = require('@playwright/test');
const { open, openWeb, compiles, critics, toggleTarget, send } = require('./helpers');

for (const kind of ['web', 'artifact']) {
  test.describe(kind, () => {
    let app;
    test.beforeEach(async ({ page }) => { app = await open(kind, page); });

    test('checks a pasted prompt locally without calling Claude', async ({ page }) => {
      await page.click('[data-mode="audit"]');
      await toggleTarget(page, 'illustrious');
      await page.fill('#input', 'masterpiece, best quality, absurdres, 1girl, solo, blue_eyes, perfect hands, blue eyes\nNegative prompt: lowres, blue eyes');
      await page.click('[data-local]');
      await expect(page.locator('.run')).toHaveCount(1);
      expect(app.calls).toHaveLength(0);
      await expect(page.locator('.pipe')).toContainText('Local check · no Claude call');

      await page.click('[data-tab="illustrious"]');
      const lint = page.locator('.lint');
      await expect(lint).toContainText('Anatomy pseudo-terms do not fix anatomy: perfect hands');
      await expect(lint).toContainText('Negative contradicts positive: blue eyes');
      await expect(lint).toContainText('Underscores inside tags (use spaces): blue_eyes');

      await page.click('[data-mode="generate"]');
      await send(page, 'A real request', 2);
      expect(compiles(app.calls).every((c) => c.turns === 1)).toBe(true);
    });

    test('runs the test bench and tabulates the results', async ({ page }) => {
      await page.click('[data-view="test"]');
      await page.fill('#benchIdeas', 'idea one\nidea two');
      await page.locator('#benchIdeas').blur();
      await page.click('[data-bt="illustrious"]');
      const run = page.locator('[data-b="run"]');
      await expect(run).toHaveText('Run test — 8 Claude calls');
      await run.click();
      await expect(run).toHaveText('Run 8 Claude calls? Tap again');
      await run.click();

      const rows = page.locator('#test .panel table').first().locator('tbody tr');
      await expect(rows).toHaveCount(2);
      await expect(page.locator('body')).not.toHaveClass(/busy/);
      await expect(rows.nth(0)).toContainText('Tsubaki.3');
      await expect(rows.nth(0)).toContainText('2 pass · 0 fix');
      await expect(rows.nth(1)).toContainText('Illustrious');
      await expect(rows.nth(1)).toContainText('2/2');
      await expect(rows.nth(1)).toContainText('0 pass · 2 fix');
      expect(compiles(app.calls)).toHaveLength(4);
      expect(critics(app.calls)).toHaveLength(4);
      expect(compiles(app.calls).every((c) => !c.system.includes('\n<memory>\nmodel:'))).toBe(true);

      const saved = await page.evaluate(() => ({ bench: JSON.parse(localStorage.getItem('ruvet.bench')), memory: JSON.parse(localStorage.getItem('ruvet.memory') || '{}') }));
      expect(saved.bench.runs).toHaveLength(1);
      expect(saved.bench.runs[0].versions.illustrious).toMatch(/^[0-9a-f]{1,6}$/);
      expect(saved.memory.ledger ?? []).toHaveLength(0);
    });
  });
}

test('web app shows the tokens each result used', async ({ page }) => {
  await openWeb(page);
  await send(page, 'An old repairman fixing a carousel', 1);
  await expect(page.locator('.sum')).toContainText('in · ');
});
