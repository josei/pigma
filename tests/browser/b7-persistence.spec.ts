import { test, expect } from '@playwright/test';
import { boot, drawShape, field } from './helpers';

test('B7a an edit is written to local persistence', async ({ page }) => {
  await boot(page);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);

  await drawShape(page, 'Rectangle', 200, 120);

  await expect.poll(async () => page.evaluate(() => localStorage.length)).toBeGreaterThan(0);
});

test('B7b the document survives a reload', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 200, 120);
  const rows = await page.locator('.layer-row').count();

  // Reload WITHOUT ?blank=1: the flag boots a fresh empty document each time.
  await page.goto('/');
  await page.waitForSelector('.app');

  await expect(page.locator('.layer-row')).toHaveCount(rows);
});

test('B7c a restored document keeps node geometry', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 220, 140);
  const name = (await page.locator('.layer-row--selected .layer-row__name').first().textContent())!;
  const x0 = await field(page, 'X').inputValue();
  const y0 = await field(page, 'Y').inputValue();
  const w0 = await field(page, 'W').inputValue();
  const h0 = await field(page, 'H').inputValue();

  await page.goto('/');
  await page.waitForSelector('.app');

  // Re-select the drawn node by name, then re-read its geometry.
  await page.locator('.layer-row', { hasText: name }).first().click();
  await expect(field(page, 'W')).toHaveValue(w0);
  await expect(field(page, 'H')).toHaveValue(h0);
  await expect(field(page, 'X')).toHaveValue(x0);
  await expect(field(page, 'Y')).toHaveValue(y0);
});

test('B7d a fresh context starts from the starter document', async ({ page }) => {
  await boot(page);
  await expect(page.locator('.layer-row').first()).toBeVisible();
  await expect(page.locator('.page-row')).toHaveCount(1);
});

test('B7e the restored document keeps its pages', async ({ page }) => {
  await boot(page);
  await page.locator('button[aria-label="Add page"]').click();
  await expect(page.locator('.page-row')).toHaveCount(2);

  await page.reload();
  await page.waitForSelector('.app');

  await expect(page.locator('.page-row')).toHaveCount(2);
});
