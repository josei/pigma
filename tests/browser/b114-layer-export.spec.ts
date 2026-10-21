/**
 * Per-layer export (Figma's Export section): a layer gets a list of exports (a PNG at a scale, or an SVG), each with
 * a suffix, and Export writes one file per setting named from the layer. The naming is unit-tested
 * (exportSettings.test.ts); this drives the panel and reads the downloads.
 */
import { test, expect, type Download } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { boot, drawShape } from './helpers';

test('B114a a layer exports a 2x PNG and an SVG, each named from the layer and its suffix', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 120, 80);
  await page.locator('.layer-row', { hasText: 'Rectangle 1' }).first().click();

  await page.getByRole('button', { name: 'Add export setting' }).click();
  await page.locator('[aria-label="Export scale"]').selectOption('2');
  await page.locator('[aria-label="Export suffix"]').fill('-2x');
  await page.getByRole('button', { name: 'Add export setting' }).click();
  await page.locator('[aria-label="Export format"]').nth(1).selectOption('SVG');

  const downloads: Download[] = [];
  page.on('download', (download) => downloads.push(download));
  await page.getByRole('button', { name: 'Export 2 files' }).click();
  await expect.poll(() => downloads.length, { timeout: 15000 }).toBe(2);

  const names = downloads.map((download) => download.suggestedFilename()).sort();
  expect(names).toEqual(['Rectangle-1-2x.png', 'Rectangle-1.svg']);
  const png = downloads.find((download) => download.suggestedFilename().endsWith('.png'))!;
  expect(readFileSync(await png.path()).subarray(1, 4).toString('latin1')).toBe('PNG');
  const svg = downloads.find((download) => download.suggestedFilename().endsWith('.svg'))!;
  expect(readFileSync(await svg.path(), 'utf8')).toContain('<svg');
});

test('B114b a setting can be removed, and with none left the Export button is gone', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 120, 80);
  await page.locator('.layer-row', { hasText: 'Rectangle 1' }).first().click();

  await page.getByRole('button', { name: 'Add export setting' }).click();
  await expect(page.getByRole('button', { name: 'Export 1 file' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove export setting' }).click();
  await expect(page.getByRole('button', { name: 'Export 1 file' })).toHaveCount(0);
  await expect(page.locator('[aria-label="Export format"]')).toHaveCount(0);
});
