/**
 * The stroke Weight field for a selection of several layers with strokes: when the layers share a weight the field
 * shows it, and when they differ it is empty, shows a dash and says "Mixed" in its tooltip. Typing sets every selected
 * layer. The rule is the isMixedValue check used by the other fields; this drives the live panel.
 */
import { test, expect } from '@playwright/test';
import { boot, drawShape, field, tool } from './helpers';

/** Two rectangles, each with a stroke: the first at 4px, the second at the default 1px. */
async function twoStrokeWeights(page: import('@playwright/test').Page) {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 120, 90, -120, 0);
  await page.getByRole('button', { name: 'Add Stroke' }).click();
  await field(page, 'Weight').fill('4');
  await field(page, 'Weight').press('Enter');
  await drawShape(page, 'Rectangle', 120, 90, 120, 0);
  await page.getByRole('button', { name: 'Add Stroke' }).click();
  await tool(page, 'Move').click();
  await page.keyboard.press('Control+A');
  await expect(page.getByText('2 layers selected')).toBeVisible();
}

test('B129a a mixed stroke weight is empty, shows a dash, and its tooltip says Mixed', async ({ page }) => {
  await twoStrokeWeights(page);
  const weight = field(page, 'Weight');
  await expect(weight).toHaveValue('');
  await expect(weight).toHaveAttribute('placeholder', '—');
  await expect(weight).toHaveAttribute('title', 'Mixed');
});

test('B129b typing a stroke weight sets every selected layer, so the field shows it with no Mixed state', async ({ page }) => {
  await twoStrokeWeights(page);
  const weight = field(page, 'Weight');
  await weight.fill('3');
  await weight.press('Enter');
  await expect(weight).toHaveValue('3');
  await expect(weight).not.toHaveAttribute('title', 'Mixed');
});
