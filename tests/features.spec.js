// Kit, render review, prompts read out of PNGs, and backup / restore — on both versions.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const { open, compiles, idle, toggleTarget, send, pngWithText } = require('./helpers');

for (const kind of ['web', 'artifact']) {
  test.describe(kind, () => {
    let app;
    test.beforeEach(async ({ page }) => { app = await open(kind, page); });

    test('kit characters and LoRAs reach the request and the lint', async ({ page }) => {
      await page.click('[data-view="kit"]');
      await page.fill('[data-form="chars"] [data-k="name"]', 'Mira');
      await page.fill('[data-form="chars"] [data-k="identity"]', 'silver bob, grey eyes, tall');
      await page.fill('[data-form="chars"] [data-k="outfit"]', 'red scarf, navy peacoat');
      await page.click('[data-kit="save"][data-kind="chars"]');
      await page.fill('[data-form="loras"] [data-k="name"]', 'inkwash');
      await page.fill('[data-form="loras"] [data-k="trigger"]', 'inkwash style');
      await page.fill('[data-form="loras"] [data-k="weight"]', '1.2');
      await page.click('[data-kit="save"][data-kind="loras"]');
      await expect(page.locator('#kit .lessons li')).toHaveCount(2);

      await page.click('[data-view="studio"]');
      await page.click('#optsBtn');
      await page.click('#targets [data-target="illustrious"]');
      await page.click('#targets [data-target="tsubaki3"]');
      await page.click('[data-char]');
      await page.click('[data-lora]');
      await page.click('#optsBtn');
      await send(page, 'Mira waiting at the harbor', 1);

      await expect(page.locator('.lint')).toContainText('LoRA trigger missing from the prompt: inkwash style');
      await expect(page.locator('.lint')).toContainText('Style LoRA "inkwash" above 1.0');
      const user = compiles(app.calls)[0].user;
      expect(user).toContain('characters: [{"name":"Mira"');
      expect(user).toContain('loras: [{"name":"inkwash","trigger":"inkwash style","weight":1.2,"type":"style","base":"sdxl"}]');
    });

    test('an SDXL LoRA is flagged on a DiT target', async ({ page }) => {
      await page.click('[data-view="kit"]');
      await page.fill('[data-form="loras"] [data-k="name"]', 'sdxl-only');
      await page.click('[data-kit="save"][data-kind="loras"]');
      await page.click('[data-view="studio"]');
      await page.click('#optsBtn'); await page.click('[data-lora]'); await page.click('#optsBtn');
      await send(page, 'A quiet street', 1);
      await expect(page.locator('.lint')).toContainText('is an SDXL LoRA; it does not run on Tsubaki.3');
    });

    test('render review records the verdict and repairs with the image', async ({ page }) => {
      await toggleTarget(page, 'illustrious');
      await toggleTarget(page, 'tsubaki3');
      await send(page, 'An old repairman fixing a carousel', 1);
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-act="review"]')]);
      await chooser.setFiles({ name: 'render.png', mimeType: 'image/png', buffer: await page.screenshot() });

      await expect(page.locator('.review')).toContainText('failed');
      await expect(page.locator('.review')).toContainText('Broke: broken hands');
      await expect(page.locator('.review')).not.toContainText('not a real issue');
      await expect(page.locator('.review')).toContainText('Held up: lighting, scarf');
      const memory = await page.evaluate(() => JSON.parse(localStorage.getItem('ruvet.memory')));
      expect(memory.feedback).toHaveLength(1);
      expect(memory.feedback[0]).toMatchObject({ target: 'illustrious', verdict: 'failed', issues: ['broken hands'] });
      expect(app.calls.find((c) => c.system.startsWith('You review')).image).toBe(true);

      await page.click('[data-act="rrepair"]');
      await idle(page, 2);
      const repair = compiles(app.calls).at(-1);
      expect(repair.image).toBe(true);
      expect(repair.user).toContain('mode: repair');
      expect(repair.user).toContain('The render failed: broken hands.');
    });

    test('reads the prompt embedded in an A1111 or ComfyUI PNG', async ({ page }) => {
      await page.setInputFiles('#file', { name: 'a1111.png', mimeType: 'image/png', buffer: pngWithText('parameters', '1girl, solo, red scarf\nNegative prompt: lowres, bad hands\nSteps: 28, Sampler: Euler a, CFG scale: 6') });
      await expect(page.locator('#input')).toHaveValue('positive: 1girl, solo, red scarf\nnegative: lowres, bad hands\nsettings: Steps: 28, Sampler: Euler a, CFG scale: 6');
      await expect(page.locator('[data-mode="audit"]')).toHaveAttribute('aria-pressed', 'true');

      await page.click('#attachDel'); await page.fill('#input', '');
      const graph = { 3: { class_type: 'KSampler', inputs: {} }, 6: { class_type: 'CLIPTextEncode', inputs: { text: 'a lighthouse at dawn' } }, 7: { class_type: 'CLIPTextEncode', inputs: { text: 'blurry' } } };
      await page.setInputFiles('#file', { name: 'comfy.png', mimeType: 'image/png', buffer: pngWithText('prompt', JSON.stringify(graph)) });
      await expect(page.locator('#input')).toHaveValue('prompt 1: a lighthouse at dawn\nprompt 2: blurry');
    });

    test('backs everything up to one file and restores it', async ({ page }) => {
      await send(page, 'An old repairman fixing a carousel', 1);
      await page.click('[data-act="save"]');
      await page.click('[data-view="memory"]');

      let text;
      if (kind === 'web') {
        const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-m="backup"]')]);
        expect(dl.suggestedFilename()).toMatch(/^ruvet-backup-\d{4}-\d{2}-\d{2}\.json$/);
        text = fs.readFileSync(await dl.path(), 'utf8');
      } else {
        await page.click('[data-m="backup"]');
        await expect.poll(() => app.saved.length).toBe(1);
        text = app.saved[0].data;
      }
      const backup = JSON.parse(text);
      expect(backup.app).toBe('RUVET.');
      expect(backup.chats).toHaveLength(1);
      expect(backup.library).toHaveLength(1);
      expect(text).not.toContain('sk-ant');

      await page.click('#setBtn');
      await page.click('#wipeBtn'); await page.click('#wipeBtn');
      await expect(page.locator('.empty')).toBeVisible();
      await expect(page.locator('#chats .open')).toHaveCount(0);

      await page.click('[data-view="memory"]');
      await page.click('[data-m="restore"]');
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-m="restore"]')]);
      await chooser.setFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(text) });
      await expect(page.locator('#chats .open')).toHaveCount(1);
      await expect(page.locator('[data-view="library"]')).toContainText('1');
    });
  });
}
