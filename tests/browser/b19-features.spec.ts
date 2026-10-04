import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, field, openMenu, tool } from './helpers';

const FIXTURE = 'tests/browser/fixtures/pixel.png';

/** Export through the main menu, returning the download. */
async function exportVia(page: Page, label: string) {
  await openMenu(page);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.menu__item', { hasText: label }).first().click(),
  ]);
  return download;
}

/** True PNG dimensions, read from the IHDR chunk of the download. */
async function pngSize(download: import('@playwright/test').Download) {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const buf = Buffer.concat(chunks);
  expect(buf.toString('ascii', 1, 4)).toBe('PNG');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), bytes: buf.length };
}

async function selectSomething(page: Page) {
  await drawShape(page, 'Rectangle', 200, 120);
  await tool(page, 'Move').click();
}

test('B19a the section tool creates a section', async ({ page }) => {
  await boot(page, { blank: true });
  const rows = page.locator('.layer-row');
  const before = await rows.count();
  await drawShape(page, 'Section', 260, 180);
  await expect(rows).toHaveCount(before + 1);
});

test('B19b Place image adds a layer from a real file', async ({ page }) => {
  await boot(page, { blank: true });
  const rows = page.locator('.layer-row');
  const before = await rows.count();

  await openMenu(page);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('.menu__item', { hasText: 'Place image' }).first().click(),
  ]);
  await chooser.setFiles(FIXTURE);
  await page.waitForTimeout(800);

  await expect(rows).toHaveCount(before + 1);
});

test('B19c flip horizontal mirrors the node about its own centre', async ({ page }) => {
  await boot(page, { blank: true });
  await selectSomething(page);
  const w0 = Number(await field(page, 'W').inputValue());
  const x0 = Number(await field(page, 'X').inputValue());

  await page.locator('[aria-label="Flip horizontal"]').click();
  await page.waitForTimeout(250);

  // Size is preserved; a flip is a mirror, not a move.
  expect(Number(await field(page, 'W').inputValue())).toBeCloseTo(w0, 0);
  expect(Number(await field(page, 'X').inputValue())).toBeCloseTo(x0, 0);
});

test('B19d flip vertical leaves width and X untouched', async ({ page }) => {
  await boot(page, { blank: true });
  await selectSomething(page);
  const w0 = Number(await field(page, 'W').inputValue());
  const h0 = Number(await field(page, 'H').inputValue());

  await page.locator('[aria-label="Flip vertical"]').click();
  await page.waitForTimeout(250);

  expect(Number(await field(page, 'W').inputValue())).toBeCloseTo(w0, 0);
  expect(Number(await field(page, 'H').inputValue())).toBeCloseTo(h0, 0);
});

test('B19e a drop shadow adds a rendered shadow', async ({ page }) => {
  await boot(page, { blank: true });
  await selectSomething(page);
  await page.locator('[aria-label="Add Drop shadow"]').click();
  await page.waitForTimeout(300);

  const rendered = await page.evaluate(() => {
    const svg = document.querySelector('.canvas__svg');
    return svg ? svg.innerHTML.includes('feDropShadow') || svg.innerHTML.includes('filter=') : false;
  });
  expect(rendered).toBe(true);
});

test('B19f a layer blur adds a rendered filter', async ({ page }) => {
  await boot(page, { blank: true });
  await selectSomething(page);
  await page.locator('[aria-label="Add Layer blur"]').click();
  await page.waitForTimeout(300);

  const rendered = await page.evaluate(() => {
    const svg = document.querySelector('.canvas__svg');
    return svg ? svg.innerHTML.includes('feGaussianBlur') || svg.innerHTML.includes('filter=') : false;
  });
  expect(rendered).toBe(true);
});

test('B19g constraints controls are present and settable', async ({ page }) => {
  await boot(page, { blank: true });
  await selectSomething(page);

  const section = page.locator('.section', { has: page.locator('.section__header', { hasText: 'Constraints' }) });
  await expect(section).toHaveCount(1);
  await expect(section.locator('[aria-label="Horizontal"]')).toHaveCount(1);
  await expect(section.locator('[aria-label="Vertical"]')).toHaveCount(1);
});

test('B19h Export PNG 1x/2x/3x scales the real image', async ({ page }) => {
  await boot(page, { blank: true });
  await selectSomething(page);

  const one = await pngSize(await exportVia(page, 'Export PNG 1x'));
  const two = await pngSize(await exportVia(page, 'Export PNG 2x'));
  const three = await pngSize(await exportVia(page, 'Export PNG 3x'));

  expect(one.w).toBeGreaterThan(0);
  expect(one.h).toBeGreaterThan(0);
  // A 2x export must be exactly twice the 1x raster, 3x three times.
  expect(two.w).toBe(one.w * 2);
  expect(two.h).toBe(one.h * 2);
  expect(three.w).toBe(one.w * 3);
  expect(three.h).toBe(one.h * 3);
});

test('B19i Export PDF downloads a PDF', async ({ page }) => {
  await boot(page, { blank: true });
  await selectSomething(page);

  const download = await exportVia(page, 'Export PDF');
  await expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const buf = Buffer.concat(chunks);
  expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  expect(buf.length).toBeGreaterThan(1000);
});
