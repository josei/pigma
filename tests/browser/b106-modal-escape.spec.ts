/**
 * Escape closes a modal dialog. The export panel and the share-link dialog both did not, so
 * Escape left the panel open. The key stops at the dialog: the selection behind it stays.
 */
import { test, expect } from '@playwright/test';
import { boot, drawShape, openMenu } from './helpers';

test('B106a Escape closes the export panel and keeps the selection', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 100, 80);
  await page.keyboard.press('Control+Shift+e');
  const dialog = page.getByRole('dialog', { name: 'Export options' });
  await expect(dialog).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog, 'Escape did not close the export panel').toHaveCount(0);
  await expect(page.locator('.layer-row--selected'), 'Escape also cleared the selection behind the panel').toHaveCount(1);
});

test('B106b Escape closes the copy-link dialog', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 100, 80);
  await openMenu(page);
  await page.locator('.menu__item', { hasText: 'Copy link to this document' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Copy link to this document' });
  await expect(dialog).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog, 'Escape did not close the copy-link dialog').toHaveCount(0);
});
