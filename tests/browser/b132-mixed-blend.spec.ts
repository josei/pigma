/**
 * The Blend mode select for a selection of several layers: when the layers share a blend mode the select shows it, and
 * when they differ it shows a disabled "Mixed" option. Picking a mode sets every selected layer. The shared rule is
 * isMixedValue (selectionValue.test.ts); this drives the live panel.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, nextPaint } from './helpers';

const blend = (page: Page) => page.getByLabel('Blend mode');

/** Rectangle 1 in Multiply, Rectangle 2 left in Normal, both selected. */
async function multiplyAndNormal(page: Page) {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 120, 90, -120, 0);
  await blend(page).selectOption({ label: 'Multiply' });
  await nextPaint(page);
  await drawShape(page, 'Rectangle', 120, 90, 120, 0);
  await page.keyboard.press('Control+A');
  await expect(page.getByText('2 layers selected')).toBeVisible();
}

test('B132a layers with different blend modes show Mixed, and the select has no value for it', async ({ page }) => {
  await multiplyAndNormal(page);
  await expect(blend(page)).toHaveValue('');
  await expect(blend(page).locator('option', { hasText: 'Mixed' })).toHaveCount(1);
});

test('B132b picking a mode sets every selected layer, so the select shows it and no Mixed option remains', async ({ page }) => {
  await multiplyAndNormal(page);
  await blend(page).selectOption({ label: 'Screen' });
  await nextPaint(page);
  await expect(blend(page)).toHaveValue('SCREEN');
  await expect(blend(page).locator('option', { hasText: 'Mixed' })).toHaveCount(0);
});

test('B132c a frame and a rectangle selected together do not offer Pass through, which only containers have', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Frame', 120, 90, -120, 0);
  await drawShape(page, 'Rectangle', 120, 90, 120, 0);
  await page.keyboard.press('Control+A');
  await expect(page.getByText('2 layers selected')).toBeVisible();
  await expect(blend(page).locator('option', { hasText: 'Pass through' })).toHaveCount(0);
  await expect(blend(page).locator('option', { hasText: 'Multiply' })).toHaveCount(1);
});

test('B132d two frames selected together still offer Pass through', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Frame', 120, 90, -120, 0);
  await drawShape(page, 'Frame', 120, 90, 120, 0);
  await page.keyboard.press('Control+A');
  await expect(page.getByText('2 layers selected')).toBeVisible();
  await expect(blend(page).locator('option', { hasText: 'Pass through' })).toHaveCount(1);
});
