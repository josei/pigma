/**
 * A focused checkbox or radio takes no text, so the editor's shortcuts still run while it has focus.
 * Before this, Ctrl+Z was ignored until focus moved to the canvas or a text field.
 */
import { test, expect } from '@playwright/test';
import { boot, drawShape, field } from './helpers';

test('B169a Ctrl+Z undoes the last edit while a checkbox has focus', async ({ page }) => {
  await boot(page);
  await drawShape(page, 'Rectangle', 100, 80);

  await field(page, 'W').fill('300');
  await field(page, 'W').press('Enter');
  await field(page, 'W').fill('400');
  await field(page, 'W').press('Enter');

  // Focus is moved with script, not a click, so no undo step is recorded for the checkbox itself.
  await page.getByLabel('Independent corners').focus();
  await page.keyboard.press('Control+z');

  await expect(field(page, 'W'), 'undo did not run while the checkbox had focus').toHaveValue('300');
});
