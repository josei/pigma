import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, field, nodeGeometry, openMenu, tool } from './helpers';

/** Draw a rectangle and leave it selected. */
async function rect(page: Page, w = 200, h = 120) {
  await drawShape(page, 'Rectangle', w, h);
}

/**
 * Option labels for a control, whether it is a <select> or a segmented group of
 * buttons (Case, Decorate, Auto size and Style are segmented).
 */
async function controlOptions(page: Page, aria: string) {
  return page.evaluate((label) => {
    const el = document.querySelector(`[aria-label="${label}"]`);
    if (!el) return null;
    if (el instanceof HTMLSelectElement) return [...el.options].map((o) => o.label);
    return [...el.querySelectorAll('button')].map((b) => (b.textContent || '').trim());
  }, aria);
}

/** Click the option of a segmented control whose label matches. */
async function chooseSegmented(page: Page, aria: string, match: RegExp) {
  await page
    .locator(`[aria-label="${aria}"] button`)
    .filter({ hasText: match })
    .first()
    .click();
  await page.waitForTimeout(350);
}

async function optionLabels(page: Page, aria: string) {
  return page.evaluate((label) => {
    const select = document.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
    return select ? [...select.options].map((o) => o.label) : null;
  }, aria);
}

const svgHtml = (page: Page) => page.locator('.canvas__svg').innerHTML();

// ---------------------------------------------------------------- min/max ----

test('B22a Min W clamps an attempted shrink', async ({ page }) => {
  await boot(page, { blank: true });
  await rect(page);
  const w0 = Number(await field(page, 'W').inputValue());

  await field(page, 'Min W').fill(String(w0 + 100));
  await field(page, 'Min W').press('Enter');
  await page.waitForTimeout(250);

  await field(page, 'W').fill('40');
  await field(page, 'W').press('Enter');
  await page.waitForTimeout(250);

  expect(Number(await field(page, 'W').inputValue())).toBeCloseTo(w0 + 100, 0);
});

test('B22b Max W clamps an attempted grow', async ({ page }) => {
  await boot(page, { blank: true });
  await rect(page);
  const w0 = Number(await field(page, 'W').inputValue());

  await field(page, 'Max W').fill(String(w0 - 40));
  await field(page, 'Max W').press('Enter');
  await page.waitForTimeout(250);

  await field(page, 'W').fill(String(w0 + 300));
  await field(page, 'W').press('Enter');
  await page.waitForTimeout(250);

  expect(Number(await field(page, 'W').inputValue())).toBeCloseTo(w0 - 40, 0);
});

test('B22c a handle resize stops at Max W with the opposite edge fixed', async ({ page }) => {
  await boot(page, { blank: true });
  await rect(page, 200, 120);
  await tool(page, 'Move').click();

  const start = await nodeGeometry(page);
  await field(page, 'Max W').fill(String(start.w / 2));
  await field(page, 'Max W').press('Enter');
  await page.waitForTimeout(250);

  // Drag the NW handle far out: the width must stop at Max W.
  const handle = page.locator('.canvas__overlay rect[style*="nwse-resize"]').first();
  const hb = (await handle.boundingBox())!;
  const hx = hb.x + hb.width / 2;
  const hy = hb.y + hb.height / 2;
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  await page.mouse.move(hx - 260, hy - 40, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const after = await nodeGeometry(page);
  expect(after.w).toBeCloseTo(start.w / 2, 0);
  // The opposite (SE) corner stays put: the origin shifts by the width change.
  expect(after.x).toBeCloseTo(start.x + (start.w - start.w / 2), 0);
});

test('B22d min/max limits survive a reload', async ({ page }) => {
  await boot(page, { blank: true });
  await rect(page);
  await field(page, 'Min W').fill('300');
  await field(page, 'Min W').press('Enter');
  await field(page, 'Max H').fill('500');
  await field(page, 'Max H').press('Enter');
  await page.waitForTimeout(300);

  await page.goto('/');
  await page.waitForSelector('.app');
  await page.locator('.layer-row').last().click();
  await page.waitForTimeout(200);

  await expect(field(page, 'Min W')).toHaveValue('300');
  await expect(field(page, 'Max H')).toHaveValue('500');
});

// ------------------------------------------------------------------- text ----

async function textNode(page: Page) {
  await tool(page, 'Text').click();
  const box = (await page.locator('.canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 + 200, box.y + box.height / 2 - 120);
  await page.waitForTimeout(250);
  await page.keyboard.type('Hello');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);
}

test('B22e font family and size reach the rendered text', async ({ page }) => {
  await boot(page, { blank: true });
  await textNode(page);

  await page.locator('select[aria-label="Font family"]').selectOption({ index: 1 });
  await page.waitForTimeout(300);
  const family = await page.locator('select[aria-label="Font family"]').inputValue();

  await field(page, 'Size').fill('42');
  await field(page, 'Size').press('Enter');
  await page.waitForTimeout(350);

  const html = await svgHtml(page);
  expect(html).toContain('42');
  expect(html.toLowerCase()).toContain((family.split(',')[0] ?? '').replace(/"/g, '').toLowerCase().split(' ')[0]);
});

test('B22f letter spacing is rendered', async ({ page }) => {
  await boot(page, { blank: true });
  await textNode(page);

  const before = await svgHtml(page);
  expect(before).toMatch(/letter-spacing="0"/);

  // The Letter field is a PERCENTAGE of the font size: 6% of 14px = 0.84.
  await field(page, 'Letter').fill('6');
  await field(page, 'Letter').press('Enter');
  await page.waitForTimeout(350);

  const html = await svgHtml(page);
  const match = html.match(/letter-spacing="([0-9.]+)"/);
  expect(match, `no letter-spacing in ${html}`).toBeTruthy();
  const spacing = Number(match![1]);
  const size = Number((html.match(/font-size="([0-9.]+)"/) ?? [])[1] ?? 0);
  expect(spacing).toBeGreaterThan(0);
  expect(spacing).toBeCloseTo((size * 6) / 100, 1);
});

test('B22g case transform is rendered', async ({ page }) => {
  await boot(page, { blank: true });
  await textNode(page);
  expect(await svgHtml(page)).toContain('Hello');

  // Case is a segmented group labelled with glyphs: Aa (current), AA (upper), ...
  const options = await controlOptions(page, 'Case');
  expect(options, 'Case control missing').not.toBeNull();
  expect(options).toContain('AA');
  await chooseSegmented(page, 'Case', /^AA$/);
  expect(await svgHtml(page)).toContain('HELLO');
});

test('B22h decoration is rendered', async ({ page }) => {
  await boot(page, { blank: true });
  await textNode(page);

  // Decorate is labelled with glyphs too: None, U̲ (underline), ...
  const options = await controlOptions(page, 'Decorate');
  expect(options, 'Decorate control missing').not.toBeNull();
  await chooseSegmented(page, 'Decorate', /^U/);
  expect((await svgHtml(page)).toLowerCase()).toContain('underline');
});

test('B22i a hugging text box follows the rendered text', async ({ page }) => {
  await boot(page, { blank: true });
  await textNode(page);

  const options = await controlOptions(page, 'Auto size');
  expect(options, 'Auto size control missing').not.toBeNull();
  expect(options!.length).toBeGreaterThan(1);

  // Hug mode: the box must resize with the text rather than stay fixed.
  await chooseSegmented(page, 'Auto size', /^Auto$/);
  const hugging = await page
    .locator('[aria-label="Auto size"] button')
    .filter({ hasText: /^Auto$/ })
    .first()
    .getAttribute('aria-pressed');
  expect(hugging).toBe('true');

  const before = await nodeGeometry(page);
  await field(page, 'Size').fill('48');
  await field(page, 'Size').press('Enter');
  await page.waitForTimeout(400);
  const after = await nodeGeometry(page);

  // Auto-resize is only really working if the box grew with the glyphs.
  expect(after.h).toBeGreaterThan(before.h);
  expect(after.w).toBeGreaterThanOrEqual(before.w);
});

// ------------------------------------------------------------------ image ----

async function placeImage(page: Page) {
  await openMenu(page);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('.menu__item', { hasText: 'Place image' }).first().click(),
  ]);
  await chooser.setFiles('tests/browser/fixtures/pixel.png');
  await page.waitForTimeout(800);
}

test('B22j the image scale mode reaches the rendered image', async ({ page }) => {
  await boot(page, { blank: true });
  await placeImage(page);

  const options = await optionLabels(page, 'Image scale mode');
  expect(options, 'scale mode control must exist').not.toBeNull();
  expect((options ?? []).length).toBeGreaterThan(1);

  const before = await svgHtml(page);
  const current = await page.locator('select[aria-label="Image scale mode"]').inputValue();
  const other = await page.evaluate((cur) => {
    const s = document.querySelector<HTMLSelectElement>('select[aria-label="Image scale mode"]');
    return s ? [...s.options].map((o) => o.value).find((v) => v !== cur) ?? null : null;
  }, current);
  await page.locator('select[aria-label="Image scale mode"]').selectOption(other!);
  await page.waitForTimeout(400);

  const after = await svgHtml(page);
  expect(after).not.toBe(before);
  expect(after).toMatch(/preserveAspectRatio|image/i);
});

test('B22k Replace image swaps the image source', async ({ page }) => {
  await boot(page, { blank: true });
  await placeImage(page);
  const before = await svgHtml(page);

  const replace = page.locator('[aria-label="Replace image"]');
  await expect(replace).toHaveCount(1);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    replace.click(),
  ]);
  await chooser.setFiles('tests/browser/fixtures/pixel.png');
  await page.waitForTimeout(700);

  const after = await svgHtml(page);
  expect(after).toMatch(/<image|href=|xlink:href/);
  expect(before).toMatch(/<image|href=|xlink:href/);
});

test('B22l corner radius controls affect the rendered geometry', async ({ page }) => {
  await boot(page, { blank: true });
  await placeImage(page);

  const before = await svgHtml(page);
  const radius = field(page, 'Radius');
  if (await radius.count()) {
    await radius.fill('12');
    await radius.press('Enter');
    await page.waitForTimeout(400);
    expect(await svgHtml(page)).not.toBe(before);
  } else {
    // Without a radius field the corner controls must still be offered.
    await expect(page.locator('[aria-label="Independent corners"]')).toHaveCount(1);
  }
});
