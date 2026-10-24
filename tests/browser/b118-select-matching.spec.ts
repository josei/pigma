/**
 * Select all matching layers (Figma: Cmd/Ctrl+Alt+A): with a layer selected, every layer in the frame that holds it
 * with the same type and name is selected too. The rule is unit-tested (matching.test.ts); this drives the live
 * canvas and the layers panel.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape } from './helpers';

/** Rename a layer row by double-clicking it and typing a new name. */
async function rename(page: Page, from: string, to: string) {
  const row = page.locator('.layer-row', { hasText: from }).first();
  await row.dblclick();
  // ControlOrMeta: inside the name field Control+A is "line start" on macOS, so the old name was not replaced.
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(to);
  await page.keyboard.press('Enter');
}

test('B118a Cmd/Ctrl+Alt+A selects the layers in the frame that match the one selected, and no others', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Frame', 300, 300);
  await drawShape(page, 'Rectangle', 40, 40, -60, 0);
  await drawShape(page, 'Rectangle', 40, 40, 60, 0);
  await drawShape(page, 'Rectangle', 40, 40, 0, 80);
  await rename(page, 'Rectangle 1', 'Card');
  await rename(page, 'Rectangle 2', 'Card');
  await rename(page, 'Rectangle 3', 'Icon');

  await page.locator('.layer-row', { hasText: 'Card' }).first().click();
  await page.keyboard.press('ControlOrMeta+Alt+a');

  await expect(page.locator('.layer-row--selected')).toHaveCount(2);
  await expect(page.locator('.layer-row--selected', { hasText: 'Card' })).toHaveCount(2);
  await expect(page.locator('.layer-row--selected', { hasText: 'Icon' })).toHaveCount(0);
});
