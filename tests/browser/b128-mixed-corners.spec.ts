/**
 * The per-corner radius fields (Top left, Top right, Bottom right, Bottom left) for a selection of several
 * rectangles with independent corners. Each corner is compared on its own: a corner that differs shows a dash and
 * "Mixed", and one that agrees shows its value. Typing sets that corner on every selected layer. The rule is the same
 * isMixedValue check as the other fields; this drives the live panel.
 */
import { test, expect } from '@playwright/test';
import { boot, drawShape, field, tool } from './helpers';

/** Two rectangles with independent corners. The first has a 10px top-left corner; the second keeps 0 everywhere. */
async function twoIndependentCorners(page: import('@playwright/test').Page) {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 120, 90, -120, 0);
  await page.getByLabel('Independent corners').check();
  await field(page, 'Top left').fill('10');
  await field(page, 'Top left').press('Enter');
  await drawShape(page, 'Rectangle', 120, 90, 120, 0);
  await page.getByLabel('Independent corners').check();
  await tool(page, 'Move').click();
  await page.keyboard.press('Control+A');
  await expect(page.getByText('2 layers selected')).toBeVisible();
}

test('B128a a corner that differs shows a dash, and a corner that agrees shows its value', async ({ page }) => {
  await twoIndependentCorners(page);
  const topLeft = field(page, 'Top left');
  await expect(topLeft).toHaveValue('');
  await expect(topLeft).toHaveAttribute('placeholder', '—');
  await expect(topLeft).toHaveAttribute('title', 'Mixed');
  const topRight = field(page, 'Top right');
  await expect(topRight).toHaveValue('0');
  await expect(topRight).not.toHaveAttribute('placeholder', '—');
});

test('B128b typing into a mixed corner sets that corner on every selected layer', async ({ page }) => {
  await twoIndependentCorners(page);
  const topLeft = field(page, 'Top left');
  await topLeft.fill('6');
  await topLeft.press('Enter');
  await expect(topLeft).toHaveValue('6');
  await expect(topLeft).not.toHaveAttribute('title', 'Mixed');
});
