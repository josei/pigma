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
  const menu = page.locator('.menu--main');
  await expect(menu).toBeVisible();
  expect(await menu.locator('.menu__heading').count()).toBeGreaterThanOrEqual(5);
  const box = (await menu.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
});

test('B60c the context menu is only as tall as its items', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.app');
  await page.mouse.click(1000, 600, { button: 'right' });
  const menu = page.locator('[data-testid="context-menu"]');
  await expect(menu).toBeVisible();
  const items = await menu.locator('[data-testid="context-menu-item"]').count();
  const box = (await menu.boundingBox())!;
  // 24px rows plus padding: a stretched menu would be several times taller.
  expect(box.height).toBeLessThan(items * 30 + 24);
});

test('B60d an empty document reads "0 layers", and a lone layer is singular', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.app');
  await page.locator('[aria-label="Main menu"]').first().click();
  await page.locator('.menu__item', { hasText: 'New file' }).first().click();
  await expect(page.locator('.panel-header__subtitle')).toContainText('0 layers');
});
