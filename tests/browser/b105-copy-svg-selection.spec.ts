/**
 * Copy as SVG takes the selection, as Copy CSS does. With nothing selected it says so and
 * leaves the clipboard alone, rather than copying the whole page without being asked.
 */
import { test, expect } from '@playwright/test';
import { boot, drawShape, openMenu } from './helpers';

const APP_ORIGIN = 'http://127.0.0.1:5173';

async function copyViaMenu(page: import('@playwright/test').Page) {
  await openMenu(page);
  await page.locator('.menu__item', { hasText: 'Copy as SVG' }).first().click();
}

test('B105a Copy as SVG with nothing selected says what to do and copies nothing', async ({ page, context }) => {
  test.skip(test.info().project.name !== 'chromium', 'Playwright grants clipboard permissions only in Chromium');
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: APP_ORIGIN });
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 200, 120);
  // Clicking empty canvas clears the selection.
  await page.locator('.canvas').first().click({ position: { x: 10, y: 10 } });
  await page.evaluate(() => navigator.clipboard.writeText('before'));

  await copyViaMenu(page);
  await expect(page.locator('.toast, [role="status"]').filter({ hasText: 'Select a layer to copy as SVG' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('before');
});

test('B105b Copy as SVG with a layer selected copies that layer as SVG', async ({ page, context }) => {
  test.skip(test.info().project.name !== 'chromium', 'Playwright grants clipboard permissions only in Chromium');
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: APP_ORIGIN });
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 200, 120);

  await copyViaMenu(page);
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 15000 }).toMatch(/<svg[\s\S]*<rect/);
});
