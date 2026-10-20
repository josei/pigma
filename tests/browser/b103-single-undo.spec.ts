/**
 * Every commit from a field is one undo step: Opacity, Rotation and a layer rename each
 * come back in a single Ctrl+Z. B102 covers the Size and W fields; this covers the rest of
 * the common single-value edits, so a double commit in any of them is caught here.
 */
import { test, expect } from '@playwright/test';
import { boot, drawShape, field } from './helpers';

test('B103a Opacity and Rotation each come back in one undo', async ({ page }) => {
  await boot(page);
  await drawShape(page, 'Rectangle', 100, 80);

  for (const [label, value, original] of [['Opacity', '50', '100'], ['Rotation', '30', '0']] as const) {
    await field(page, label).fill(value);
    await field(page, label).press('Enter');
    await page.keyboard.press('Control+z');
    await expect(field(page, label), `one undo did not revert ${label}`).toHaveValue(original);
  }
});

test('B103b a layer rename is one undo step', async ({ page }) => {
  await boot(page);
  await drawShape(page, 'Rectangle', 100, 80);
  const row = page.locator('.layer-row--selected .layer-row__name').first();
  const name = (await row.textContent())!;

  await row.dblclick();
  const input = page.locator('.layer-row input').first();
  await input.fill('Renamed');
  await input.press('Enter');
  await page.keyboard.press('Control+z');

  await expect(page.locator('.layer-row--selected .layer-row__name').first(), 'one undo did not revert the rename').toHaveText(name);
});
