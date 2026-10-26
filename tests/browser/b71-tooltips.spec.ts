import { test, expect } from '@playwright/test';
import { boot, drawShape } from './helpers';

/** A tooltip in the right panel must stay inside the window. */
test('B71a right-panel tooltips anchor to the right edge, so they are not clipped', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Frame', 200, 160);
  await page.locator('.rail__button[aria-label="Layers"]').click();
  await page.getByRole('tab', { name: 'Prototype' }).or(page.locator('text=Prototype').first()).click();
  const add = page.locator('[aria-label="Add interaction"]');
  await expect(add).toBeVisible();
  const style = await add.evaluate((el) => {
    const after = getComputedStyle(el, '::after');
    return { right: after.right, top: after.top, transform: after.transform };
  });
  expect(style.right, 'right-panel tooltip is still centred on its button').toBe('0px');
  expect(style.transform).toBe('none');
  // Below the button, not above: above, the scrolling panel clips it.
  expect(style.top, 'right-panel tooltip still opens upward into the clipped header').not.toBe('auto');
});
