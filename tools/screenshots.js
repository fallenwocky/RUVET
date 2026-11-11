// Regenerates the README screenshots from the artifact build with a mocked Claude: `npm run screenshots`.
const path = require('path');
const { chromium, devices } = require('@playwright/test');
const { openArtifact, toggleTarget, send } = require('../tests/helpers');

const out = (n) => path.join(__dirname, '..', 'screenshots', n);

(async () => {
  const browser = await chromium.launch();
  const shoot = async (ctxOpts, name, steps) => {
    const ctx = await browser.newContext({ serviceWorkers: 'block', ...ctxOpts });
    const page = await ctx.newPage();
    await openArtifact(page);
    await steps(page);
    await page.waitForTimeout(300);
    await page.screenshot({ path: out(name) });
    await ctx.close();
    console.log('wrote', name);
  };
  const result = async (page) => {
    await toggleTarget(page, 'illustrious');
    await send(page, 'An old repairman fixing a carousel alone in a closed amusement park', 1);
    await page.click('[data-tab="illustrious"]');
    await page.locator('.run').first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
  };
  await shoot({ ...devices['iPhone 14'], deviceScaleFactor: 2, colorScheme: 'dark' }, 'phone-studio.png', result);
  await shoot({ viewport: { width: 1366, height: 860 }, deviceScaleFactor: 2, colorScheme: 'light' }, 'desktop-studio.png', result);
  await shoot({ viewport: { width: 1366, height: 860 }, deviceScaleFactor: 2, colorScheme: 'dark' }, 'desktop-test.png', async (page) => {
    await page.click('[data-view="test"]');
    await page.fill('#benchIdeas', 'An old repairman fixing a carousel\nA witch who missed the last train\nA fox spirit selling lanterns at a snowy roadside stall');
    await page.locator('#benchIdeas').blur();
    await page.click('[data-bt="illustrious"]'); await page.click('[data-bt="anima"]');
    await page.click('[data-b="run"]'); await page.click('[data-b="run"]');
    await page.locator('#test .panel table').first().locator('tbody tr').nth(2).waitFor();
    await page.locator('body:not(.busy)').waitFor();
    await page.locator('#test .panel').nth(1).evaluate((el) => el.scrollIntoView({ block: 'start' }));
  });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
