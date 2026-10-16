import { test, expect } from '@playwright/test';
import { boot, drawShape } from './helpers';

/** Renaming selects the whole name, so typing replaces it (Figma's behaviour), for pages and layers. */
test('B70a renaming a page replaces its name when you type', async ({ page }) => {
  await boot(page, { blank: true });
  await page.locator('button[aria-label="Add page"]').click();
  const row = page.locator('.page-row__name').nth(1);
  await row.dblclick();
  await page.keyboard.type('Notes');
  await page.keyboard.press('Enter');
  await expect(page.locator('.page-row__name').nth(1)).toHaveText('Notes');
});

test('B70b renaming a layer replaces its name when you type', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 160, 120);
  await page.locator('.rail__button[aria-label="Layers"]').click();
  await page.locator('.layer-row').first().dblclick();
  await page.keyboard.type('Card');
  await page.keyboard.press('Enter');
  await expect(page.locator('.layer-row__name', { hasText: /^Card$/ })).toHaveCount(1);
});
