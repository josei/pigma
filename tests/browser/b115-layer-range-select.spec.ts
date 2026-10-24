/**
 * Selecting layers in the Layers panel (Figma's "Select layers and objects"): Shift-click selects the rows from the
 * last row clicked to this one, as the panel draws them; Cmd/Ctrl-click adds or removes one row. The order is
 * unit-tested (layerOrder.test.ts); this drives the live panel.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape } from './helpers';

/** Three rectangles, so the panel lists Rectangle 3 at the top and Rectangle 1 at the bottom. */
async function threeRectangles(page: Page) {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 60, 40, -200, 0);
  await drawShape(page, 'Rectangle', 60, 40, 0, 0);
  await drawShape(page, 'Rectangle', 60, 40, 200, 0);
}

const selectedRows = (page: Page) => page.locator('.layer-row--selected');

test('B115a Shift-click selects every layer from the clicked anchor to this row, as the panel draws them', async ({ page }) => {
  await threeRectangles(page);
  await page.locator('.layer-row', { hasText: 'Rectangle 3' }).first().click();
  await page.locator('.layer-row', { hasText: 'Rectangle 1' }).first().click({ modifiers: ['Shift'] });
  await expect(selectedRows(page)).toHaveCount(3);
});

test('B115b Cmd/Ctrl-click adds one layer and removes it again, leaving the others selected', async ({ page }) => {
  await threeRectangles(page);
  await page.locator('.layer-row', { hasText: 'Rectangle 3' }).first().click();
  await page.locator('.layer-row', { hasText: 'Rectangle 1' }).first().click({ modifiers: ['ControlOrMeta'] });
  await expect(selectedRows(page)).toHaveCount(2);
  await expect(page.locator('.layer-row', { hasText: 'Rectangle 2' }).first()).not.toHaveClass(/layer-row--selected/);

  await page.locator('.layer-row', { hasText: 'Rectangle 1' }).first().click({ modifiers: ['ControlOrMeta'] });
  await expect(selectedRows(page)).toHaveCount(1);
});
