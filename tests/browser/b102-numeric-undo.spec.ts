/**
 * One edit in a numeric field is one undo step. Enter commits and leaves the field; the
 * blur that follows must not commit the same value again, or undo needs two presses.
 */
import { test, expect } from '@playwright/test';
import { boot, drawShape, tool, canvasBox, field } from './helpers';

test('B102a Enter in the Size field is one undo step, not two', async ({ page }) => {
  await boot(page);
  await tool(page, 'Text').click();
  const c = await canvasBox(page);
  await page.mouse.click(c.x + c.width / 2, c.y + c.height / 2);
  await page.keyboard.type('Hello');
  await page.keyboard.press('Escape');

  await field(page, 'Size').fill('40');
  await field(page, 'Size').press('Enter');
  await page.keyboard.press('Control+z');

  await page.locator('.layer-row', { hasText: 'Hello' }).first().click();
  await expect(field(page, 'Size'), 'one undo did not revert the size change').toHaveValue('14');
});

// B102b is a guard, not the reproduction: it passes on the old code too. B102a is the
// edit that recorded two undo steps.
test('B102b Enter in the W field of a shape is one undo step too', async ({ page }) => {
  await boot(page);
  await drawShape(page, 'Rectangle', 100, 80);
  const before = await field(page, 'W').inputValue();

  await field(page, 'W').fill('300');
  await field(page, 'W').press('Enter');
  await page.keyboard.press('Control+z');

  await expect(field(page, 'W'), 'one undo did not revert the width').toHaveValue(before);
});
