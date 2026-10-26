import { test, expect } from '@playwright/test';
import { boot } from './helpers';

/**
 * Figma's pixel grid keys (per its help center): Cmd/Ctrl+' shows or hides the pixel grid,
 * and Cmd/Ctrl+Shift+' toggles snap to it.
 */
test('B94a Ctrl+\' toggles the pixel grid, and Ctrl+Shift+\' toggles snap to it', async ({ page }) => {
  await boot(page, { blank: true });
  const state = () => page.evaluate(() => {
    const s = window.__pigmaStore!.getState() as any;
    return { grid: s.showGrid as boolean, snap: s.snapToGrid as boolean };
  });
  expect(await state()).toEqual({ grid: false, snap: false });
  await page.keyboard.press("Control+'");
  await expect.poll(async () => (await state()).grid, 'Ctrl+\' did not show the pixel grid').toBe(true);
  await page.keyboard.press("Control+Shift+'");
  await expect.poll(async () => (await state()).snap, 'Ctrl+Shift+\' did not toggle snap').toBe(true);
  await page.keyboard.press("Control+'");
  await expect.poll(async () => (await state()).grid).toBe(false);
});
