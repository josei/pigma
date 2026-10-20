/**
 * The export panel's scope follows the selection it has now. Opening it with nothing selected
 * must offer the whole page: a stale "selection" scope from an earlier export is not a
 * selection to export.
 */
import { test, expect } from '@playwright/test';
import { boot, drawShape, openMenu } from './helpers';

test('B107a Export PNG with nothing selected exports the page, not a stale selection', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 100, 80);
  // Export the selection once, which leaves the panel's scope on "selection".
  await page.keyboard.press('Control+Shift+e');
  await page.keyboard.press('Escape');
  // Then deselect and open the panel from the menu, which keeps that scope.
  await page.locator('.canvas').first().click({ position: { x: 10, y: 10 } });
  await openMenu(page);
  await page.locator('.menu__item', { hasText: 'Export PNG…' }).click();

  await expect(page.locator('[aria-label="Export scope"]')).toHaveValue('page');
  const download = page.waitForEvent('download');
  await page.locator('[aria-label="Export now"]').click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
});
