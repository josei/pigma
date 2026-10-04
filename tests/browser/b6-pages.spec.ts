import { test, expect } from '@playwright/test';
import { boot, drawShape, clickCanvas, tool } from './helpers';

test('B6a adding a page appends a page row and activates it', async ({ page }) => {
  await boot(page);
  const before = await page.locator('.page-row').count();

  await page.locator('button[aria-label="Add page"]').click();

  await expect(page.locator('.page-row')).toHaveCount(before + 1);
  await expect(page.locator('.page-row--active')).toHaveCount(1);
});

test('B6b pages isolate their content', async ({ page }) => {
  await boot(page);
  const rows = page.locator('.layer-row');

  await drawShape(page, 'Rectangle', 200, 120);
  const withShape = await rows.count();

  await page.locator('button[aria-label="Add page"]').click();
  await expect(page.locator('.page-row')).toHaveCount(2);
  expect(await rows.count()).toBeLessThan(withShape);

  // Switch back to the first page and confirm the shape is still there.
  await page.locator('.page-row').first().click();
  await expect(rows).toHaveCount(withShape);
});

test('B6c drawing works on a newly added page', async ({ page }) => {
  await boot(page);
  await page.locator('button[aria-label="Add page"]').click();
  await drawShape(page, 'Rectangle', 160, 100);
  await tool(page, 'Move').click();
  await clickCanvas(page, 0, 0);
  await expect(page.locator('.layer-row--selected')).toHaveCount(1);
});

test('B6d deleting a page removes it', async ({ page }) => {
  await boot(page);
  await page.locator('button[aria-label="Add page"]').click();
  await expect(page.locator('.page-row')).toHaveCount(2);

  await page.locator('.page-row--active button[aria-label="Delete page"]').click();
  await expect(page.locator('.page-row')).toHaveCount(1);
});
