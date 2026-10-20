/**
 * One export panel for every format (Figma's Export panel): Export… in the main menu opens
 * it, a format is chosen there, and Export downloads that format. Each format is driven
 * and the download is read back, so a format that stops reaching its exporter fails here.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { boot, drawShape, openMenu } from './helpers';

async function openExportPanel(page: import('@playwright/test').Page) {
  await openMenu(page);
  await page.locator('.menu__item', { hasText: 'Export…' }).click();
  await expect(page.getByRole('dialog', { name: 'Export options' })).toBeVisible();
}

test('B104a the Export panel opens from the menu, and SVG hides the PNG-only controls', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 100, 80);
  await openExportPanel(page);

  const format = page.locator('[aria-label="Export format"]');
  await expect(format).toHaveValue('png');
  await expect(page.locator('[aria-label="PNG scale"]')).toBeVisible();

  await format.selectOption('svg');
  await expect(page.locator('[aria-label="PNG scale"]'), 'the scale applies to PNG only').toHaveCount(0);
  await expect(page.locator('[aria-label="Transparent background"]')).toHaveCount(0);
});

test('B104b SVG export from the panel downloads an SVG of the page', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 100, 80);
  await openExportPanel(page);
  await page.locator('[aria-label="Export format"]').selectOption('svg');

  const download = page.waitForEvent('download');
  await page.locator('[aria-label="Export now"]').click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.svg$/);
  expect(readFileSync(await file.path(), 'utf8')).toContain('<svg');
});

test('B104c PDF export from the panel downloads a PDF, and its scope is the whole page', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 100, 80);
  await openExportPanel(page);
  await page.locator('[aria-label="Export format"]').selectOption('pdf');

  await expect(page.locator('[aria-label="Export scope"] option[value="selection"]'), 'PDF cannot export a selection').toBeDisabled();

  const download = page.waitForEvent('download');
  await page.locator('[aria-label="Export now"]').click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.pdf$/);
  expect(readFileSync(await file.path()).subarray(0, 4).toString('latin1')).toBe('%PDF');
});

test('B104d the PNG path still downloads a PNG at the chosen scale', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 100, 80);
  await openExportPanel(page);
  await page.locator('[aria-label="PNG scale"]').selectOption('2');

  const download = page.waitForEvent('download');
  await page.locator('[aria-label="Export now"]').click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/-2x\.png$/);
  expect(readFileSync(await file.path()).subarray(1, 4).toString('latin1')).toBe('PNG');
});

/** A rectangle and an ellipse, with the rectangle selected: the page holds both, the selection one. */
async function twoShapesWithOneSelected(page: import('@playwright/test').Page) {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 100, 80, -150, 0);
  await drawShape(page, 'Ellipse', 80, 80, 150, 0);
  await page.locator('.layer-row', { hasText: 'Rectangle 1' }).first().click();
}

function countShapes(svg: string) {
  return { rects: (svg.match(/<rect/g) ?? []).length, ellipses: (svg.match(/<ellipse/g) ?? []).length };
}

test('B104e Export SVG from the menu exports the whole page, even with a layer selected', async ({ page }) => {
  await twoShapesWithOneSelected(page);
  await openMenu(page);
  const download = page.waitForEvent('download');
  await page.locator('.menu__item', { hasText: 'Export SVG' }).first().click();
  const svg = readFileSync(await (await download).path(), 'utf8');
  expect(countShapes(svg), 'the page export left out a layer that was not selected').toEqual({ rects: 1, ellipses: 1 });
});

test('B104f the panel exports the page with its page scope, and only the selection with its selection scope', async ({ page }) => {
  await twoShapesWithOneSelected(page);

  await openExportPanel(page);
  await page.locator('[aria-label="Export format"]').selectOption('svg');
  await page.locator('[aria-label="Export scope"]').selectOption('page');
  let download = page.waitForEvent('download');
  await page.locator('[aria-label="Export now"]').click();
  expect(countShapes(readFileSync(await (await download).path(), 'utf8'))).toEqual({ rects: 1, ellipses: 1 });

  await openExportPanel(page);
  await page.locator('[aria-label="Export format"]').selectOption('svg');
  await page.locator('[aria-label="Export scope"]').selectOption('selection');
  download = page.waitForEvent('download');
  await page.locator('[aria-label="Export now"]').click();
  expect(countShapes(readFileSync(await (await download).path(), 'utf8'))).toEqual({ rects: 1, ellipses: 0 });
});
