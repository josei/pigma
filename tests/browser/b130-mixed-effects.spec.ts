/**
 * The Effects section for a selection of several layers: when the layers' effect lists differ, the section says so and
 * shows no rows, because an edit addresses an effect by its index on every layer. The rows come back when the layers
 * match, or when one layer is selected. The comparison is canonicalKey and isMixedValue (selectionValue.test.ts); this
 * drives the live panel.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, nextPaint } from './helpers';

/** Add a drop shadow to the selected layer, opening the Add effect disclosure if it is closed. */
async function addDropShadow(page: Page) {
  const add = page.getByRole('button', { name: 'Add Drop shadow' });
  if (!(await add.isVisible())) await page.getByText('Add effect', { exact: true }).click();
  await add.click();
  await nextPaint(page);
}

/** Two rectangles: the first has a drop shadow, the second none. Both are selected. */
async function shadowOnOne(page: Page) {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 120, 90, -120, 0);
  await addDropShadow(page);
  await drawShape(page, 'Rectangle', 120, 90, 120, 0);
  await page.keyboard.press('Control+A');
  await expect(page.getByText('2 layers selected')).toBeVisible();
}

test('B130a layers with different effects show the mixed note and no effect rows', async ({ page }) => {
  await shadowOnOne(page);
  await expect(page.getByTestId('effects-mixed')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove Drop shadow' })).toHaveCount(0);
});

test('B130b selecting one of the layers brings its effect rows back', async ({ page }) => {
  await shadowOnOne(page);
  await page.locator('.layer-row', { hasText: 'Rectangle 1' }).first().click();
  await nextPaint(page);
  await expect(page.getByTestId('effects-mixed')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Remove Drop shadow' })).toHaveCount(1);
});

test('B130c matching effects on both layers bring the rows back', async ({ page }) => {
  await shadowOnOne(page);
  // Give the second layer the same default shadow, then select both again.
  await page.locator('.layer-row', { hasText: 'Rectangle 2' }).first().click();
  await nextPaint(page);
  await addDropShadow(page);
  await page.keyboard.press('Control+A');
  await expect(page.getByText('2 layers selected')).toBeVisible();
  await expect(page.getByTestId('effects-mixed')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Remove Drop shadow' })).toHaveCount(1);
});
