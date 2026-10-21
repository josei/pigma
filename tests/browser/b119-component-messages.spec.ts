/**
 * Create component (Cmd/Ctrl+Alt+K) says why it did nothing. A layer that is already a component is told so; a
 * selection of several layers is told to select one. Before, both got the same "select a single layer" message, which
 * was wrong for a component.
 */
import { test, expect } from '@playwright/test';
import { boot, drawShape } from './helpers';

test('B119a Create component on a layer that is already a component says so, not to select a single layer', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 120, 60, -150, 0);
  await page.locator('.layer-row', { hasText: 'Rectangle 1' }).first().click();
  await page.keyboard.press('Control+Alt+k');
  await page.locator('.layer-row', { hasText: 'Rectangle 1' }).first().click();
  await page.keyboard.press('Control+Alt+k');
  await expect(page.locator('.toast', { hasText: 'This layer is already a component' })).toBeVisible();
  await expect(page.locator('.toast', { hasText: 'Select a single layer' })).toHaveCount(0);
});

test('B119b Create component on several layers says to select one layer', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 120, 60, -150, 0);
  await drawShape(page, 'Ellipse', 60, 60, 100, 0);
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+Alt+k');
  await expect(page.locator('.toast', { hasText: 'Select a single layer' })).toBeVisible();
});
