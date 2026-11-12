// The deterministic lint, called directly. It must stay silent on the packs' own demo prompts.
const { test, expect } = require('@playwright/test');

test.skip(({ isMobile }) => isMobile, 'pure logic: one viewport is enough');

const DEMOS = {
  tsubaki3: ['A tired girl with short black hair and a grey hoodie stands just outside a bus shelter at night in steady rain, a closed umbrella hanging from her right hand, her left hand in the hoodie pocket, her hair and shoulders soaked. She looks down at the wet pavement, face blank, shadows under her eyes. Framed from mid-thigh up, seen from the side at eye level, she fills about half the frame height. A single streetlamp above and slightly behind her throws hard, cold white light across her wet hair while the street falls into blue darkness. 1990s anime cel look: hard-edged shadows, few flat tones, muted blue palette, light film grain. No text.', 'extra fingers, duplicate'],
  illustrious: ['masterpiece, best quality, absurdres, general, 1girl, solo, retro artstyle, film grain, cowboy shot, from side, short hair, black hair, grey hoodie, wet hair, wet clothes, bags under eyes, expressionless, looking down, standing, holding umbrella, closed umbrella, hand in pocket, bus stop, night, rain, lamppost, blue theme, muted color', 'lowres, worst quality, low quality, bad anatomy, bad hands, extra digits, fewer digits, text, watermark, signature, logo, 3d, realistic, shiny skin, bloom, lens flare, multiple views, bad perspective, crowd'],
  anima: ['masterpiece, best quality, score_7, safe, 1girl, solo, retro artstyle, film grain, cowboy shot, from side, short hair, black hair, grey hoodie, wet hair, wet clothes, bags under eyes, expressionless, looking down, bus stop, night, rain, lamppost, blue theme, muted color. She stands just outside the bus shelter, a closed umbrella hanging from her right hand, her left hand in the hoodie pocket. The lamppost above her is the only light, hard and cold on her wet hair.', 'worst quality, low quality, score_1, score_2, score_3, artist name, blurry, jpeg artifacts, bad hands, extra digits, 3d, realistic, shiny skin, bloom, lens flare, multiple views, bad perspective, crowd'],
};

let lint;
test.beforeEach(async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', (r) => r.abort());
  await page.goto('/');
  lint = (target, pos, neg = '', meta) => page.evaluate(([t, p, n, m]) => window.RUVET_LINT(t, p, n, m), [target, pos, neg, meta]);
});
const messages = (r) => r.items.map((i) => i.m).join('\n');

for (const [target, [pos, neg]] of Object.entries(DEMOS)) {
  test(`the ${target} demo prompt has no findings`, async () => {
    const r = await lint(target, pos, neg);
    expect(r.items).toEqual([]);
  });
}

test('flags a bloated description prompt', async () => {
  const r = await lint('flux', 'The image shows a breathtaking, ethereal scene of a very beautiful girl standing in a majestic forest, creating a sense of wonder. The forest is vibrant and the forest light is dreamlike, and the forest evokes calm. Highly detailed, masterpiece, 8k.');
  const m = messages(r);
  expect(m).toContain('Tag-model quality strings in a description prompt: masterpiece');
  expect(m).toContain('Narrates instead of describing');
  expect(m).toContain('Words with nothing to draw');
  expect(m).toContain('Repeated words: forest ×4');
  expect(m).toContain('Quality filler: highly detailed, 8k');
  expect(r.items.filter((i) => i.cat === 'bloat').length).toBeGreaterThanOrEqual(4);
});

test('flags a bloated, contradictory tag prompt', async () => {
  const r = await lint('illustrious', 'masterpiece, best quality, absurdres, high quality, very aesthetic, ultra detailed, 1girl, solo, blue eyes, blue eyes, cowboy shot, full body, looking at viewer, looking away, closed eyes, day, night, blue theme, red theme, 1990s (style), perfect hands', 'lowres, blue eyes');
  const m = messages(r);
  for (const s of ['perfect hands', 'Negative contradicts positive: blue eyes', 'Repeated tags: blue eyes', 'More than one framing tag', 'More than one gaze tag', 'More than one palette tag', 'Closed eyes take no gaze tag', 'Day and night', 'Quality pile', 'Unescaped parentheses']) expect(m).toContain(s);
});

test('knows each model\'s own rules', async () => {
  expect(messages(await lint('anima', 'masterpiece, best quality, score_7, general, 1girl, solo'))).toContain('safety tag is "safe", not "general"');
  expect(messages(await lint('anima_aesthetic', 'masterpiece, best quality, safe, 1girl, solo, score_7'))).toContain('takes no score tags');
  expect(messages(await lint('pony', 'masterpiece, 1girl, solo'))).toContain('Pony expects the score_9');
  expect(messages(await lint('midjourney', 'A lighthouse at dawn, waves on the rocks below.', 'blurry'))).toContain('Midjourney has no negative field');
  expect(messages(await lint('midjourney', 'A lighthouse at dawn, waves on the rocks below. --ar 2:3', 'none — see --no'))).not.toContain('negative');
  expect(messages(await lint('flux', 'A lighthouse at dawn. --ar 2:3'))).toContain('Midjourney parameters in a prompt for another model');
  expect(messages(await lint('flux', 'A lighthouse at dawn, waves breaking on the rocks below it.', 'blurry'))).toContain('no working negative prompt');
  expect(messages(await lint('illustrious', 'masterpiece, best quality, absurdres, 1girl, (smile:1.6)'))).toContain('A weight above 1.4');
  expect(messages(await lint('tsubaki3', 'A girl, (smile:1.2), standing by a window in soft light.'))).toContain('Weight syntax');
});

test('counts hybrid tags and sentences exactly', async () => {
  const [pos, neg] = DEMOS.anima;
  expect((await lint('anima', pos, neg)).count).toBe('24 tags + 2 sentences');
  const three = (await lint('anima', 'masterpiece, best quality, score_7, safe, 1girl, solo, kitchen. She stirs the pot. Her left hand rests on the handle. Light comes from the window.'));
  expect(three.count).toBe('7 tags + 3 sentences');
  expect(messages(three)).not.toContain('sentences — the hybrid pack allows 3');
  const four = await lint('anima', 'masterpiece, best quality, score_7, safe, 1girl, solo, kitchen. One. Two. Three. Four.');
  expect(messages(four)).toContain('4 sentences — the hybrid pack allows 3');
});

test('repeated-word counting is not fooled by words that are object properties', async () => {
  const r = await lint('flux', 'The constructor stands by the constructor shed while a constructor waves at another constructor near the valueOf sign.');
  expect(messages(r)).toContain('Repeated words: constructor ×4');
});

test('checks LoRAs against the target', async () => {
  const lora = { name: 'ink', trigger: 'inkwash style', weight: '1.2', type: 'style', base: 'sdxl' };
  expect(messages(await lint('tsubaki3', 'A girl reading by a window in soft morning light.', '', { loras: [lora] }))).toContain('is an SDXL LoRA; it does not run on Tsubaki.3');
  const m = messages(await lint('illustrious', 'masterpiece, best quality, absurdres, 1girl, solo', '', { loras: [lora] }));
  expect(m).toContain('LoRA trigger missing from the prompt: inkwash style');
  expect(m).toContain('above 1.0');
});
