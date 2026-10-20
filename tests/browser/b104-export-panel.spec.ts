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
