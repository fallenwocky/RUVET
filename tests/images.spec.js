// Attaching images on phones: decoder fallbacks, HEIC, memory failures, and Claude views that cannot take images.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { ROOT, open, openArtifact, compiles, idle, send, pngWithText } = require('./helpers');

const PNG = fs.readFileSync(path.join(ROOT, 'docs', 'icons', 'icon-512.png'));
const file = (name, mimeType, buffer = PNG) => ({ name, mimeType, buffer });
const imageOf = (call) => call.body?.messages.at(-1).content.find((c) => c.type === 'image')?.source;

for (const kind of ['web', 'artifact']) {
  test.describe(kind, () => {
    test('the image button is always there and the file inputs can open a picker', async ({ page }) => {
      await open(kind, page);
      await expect(page.locator('#imgBtn')).toBeVisible();
      for (const id of ['file', 'reviewFile', 'restoreFile']) expect(await page.locator('#' + id).evaluate((el) => getComputedStyle(el).display)).not.toBe('none');
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#imgBtn')]);
      await chooser.setFiles(file('photo.png', 'image/png'));
      await expect(page.locator('#attach')).toBeVisible();
    });

    test('attaches when createImageBitmap is missing', async ({ page }) => {
      await page.addInitScript(() => { delete window.createImageBitmap; });
      const app = await open(kind, page);
      await page.setInputFiles('#file', file('photo.png', 'image/png'));
      await expect(page.locator('#attach')).toBeVisible();
      await send(page, 'What is this?', 1);
      expect(compiles(app.calls)[0].image).toBe(true);
    });

    test('attaches when createImageBitmap refuses the photo', async ({ page }) => {
      await page.addInitScript(() => { window.createImageBitmap = () => Promise.reject(new DOMException('too large', 'InvalidStateError')); });
      await open(kind, page);
      await page.setInputFiles('#file', file('photo.png', 'image/png'));
      await expect(page.locator('#attach')).toBeVisible();
    });

    test('a HEIC photo the browser cannot decode gets a message that says what to do', async ({ page }) => {
      await open(kind, page);
      await page.setInputFiles('#file', file('IMG_0001.HEIC', 'image/heic', Buffer.from('ftypheic not decodable here')));
      await expect(page.locator('#toast')).toContainText('HEIC');
      await expect(page.locator('#toast')).toContainText('Most Compatible');
      await expect(page.locator('#attach')).toBeHidden();
    });

    test('a render can be reviewed when createImageBitmap is missing', async ({ page }) => {
      await page.addInitScript(() => { delete window.createImageBitmap; });
      await open(kind, page);
      await send(page, 'An idea', 1);
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-act="review"]')]);
      await chooser.setFiles(file('render.png', 'image/png'));
      await expect(page.locator('.review')).toContainText('failed');
    });
  });
}

test('when re-encoding fails on the device, a small original is sent as it is', async ({ page }) => {
  await page.addInitScript(() => { HTMLCanvasElement.prototype.toDataURL = () => 'data:,'; });
  const app = await open('web', page);
  await page.setInputFiles('#file', file('photo.png', 'image/png'));
  await expect(page.locator('#attach')).toBeVisible();
  await send(page, 'What is this?', 1);
  const src = imageOf(compiles(app.calls)[0]);
  expect(src.media_type).toBe('image/png');
  expect(Buffer.from(src.data, 'base64').equals(PNG)).toBe(true);
});

test.describe('a Claude view that cannot take images', () => {
  test('says so instead of hiding the button, and still reads PNG prompts', async ({ page }) => {
    const app = await openArtifact(page, { images: false });
    await expect(page.locator('#imgBtn')).toBeVisible();

    await page.setInputFiles('#file', file('photo.png', 'image/png'));
    await expect(page.locator('#toast')).toContainText('Images cannot be sent to Claude in this view');
    await expect(page.locator('#attach')).toBeHidden();

    await page.setInputFiles('#file', file('a1111.png', 'image/png', pngWithText('parameters', '1girl, solo\nNegative prompt: lowres')));
    await expect(page.locator('#input')).toHaveValue('positive: 1girl, solo\nnegative: lowres');
    await expect(page.locator('#toast')).toContainText('cannot be sent in this view');
    await expect(page.locator('#attach')).toBeHidden();

    await page.fill('#input', '');
    await send(page, 'An idea', 1);
    await page.click('[data-act="review"]');
    await expect(page.locator('#toast')).toContainText('Images cannot be sent to Claude in this view');
    expect(app.calls.every((c) => !c.image)).toBe(true);
  });
});
