import { test, expect } from '@playwright/test';

/**
 * The floating zoom readout must clear the ruler strips, and the main menu is a
 * grouped popover that stays inside the window.
 */
test('B60a the zoom readout does not overlap the top ruler', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.app');
  const hud = await page.locator('.canvas__hud').boundingBox();
  const canvas = await page.locator('.canvas').first().boundingBox();
  expect(hud && canvas).toBeTruthy();
  // The ruler is a 20px strip along the canvas's top edge.
  expect(hud!.y - canvas!.y).toBeGreaterThanOrEqual(20);
});

test('B60b the main menu is grouped and fits inside the window', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.app');
  await page.locator('[aria-label="Main menu"]').first().click();
  const menu = page.locator('.menu[role="menu"]');
  await expect(menu).toBeVisible();
  expect(await menu.locator('.menu__heading').count()).toBeGreaterThanOrEqual(5);
  const box = (await menu.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
});
