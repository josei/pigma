import { test, expect } from '@playwright/test';
import { boot, drawShape } from './helpers';

/** A tooltip in the left panel starts at the panel's edge and wraps, so it is not clipped. */
test('B76a left-panel tooltips anchor left and wrap, so they stay inside the window', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 120, 100);
  await page.locator('.rail__button[aria-label="Layers"]').click();
  const row = page.locator('.app__left [data-tooltip]').first();
  await expect(row).toBeVisible();
  const style = await row.evaluate((el) => {
    const after = getComputedStyle(el, '::after');
    return { left: after.left, transform: after.transform, maxWidth: after.maxWidth, whiteSpace: after.whiteSpace };
  });
  expect(style.left, 'left-panel tooltip is still centred on its row').toBe('0px');
  expect(style.transform).toBe('none');
  expect(style.maxWidth).toBe('200px');
  expect(style.whiteSpace).toBe('normal');
});
