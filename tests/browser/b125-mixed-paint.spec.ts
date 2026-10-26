/**
 * The fill and stroke rows for a selection of several layers: when the layers share a paint the row shows it, and
 * when they differ it shows "Mixed" with one swatch per distinct paint. A colour set on a mixed row goes to every
 * selected layer. The reduction is unit-tested (selectionPaintOf in paint.test.ts); this drives the live panel.
 */
import { test, expect } from '@playwright/test';
import { boot, drawShape, field, tool } from './helpers';

async function twoRectangles(page: import('@playwright/test').Page, first: string, second: string) {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 120, 90, -120, 0);
  await page.locator('input[aria-label="Fill hex"]').fill(first);
  await page.locator('input[aria-label="Fill hex"]').press('Enter');
  await drawShape(page, 'Rectangle', 120, 90, 120, 0);
  await page.locator('input[aria-label="Fill hex"]').fill(second);
  await page.locator('input[aria-label="Fill hex"]').press('Enter');
  await tool(page, 'Move').click();
  await page.keyboard.press('Control+A');
}

test('B125a two layers with different fills show Mixed and one swatch per distinct fill', async ({ page }) => {
  await twoRectangles(page, '#FF0000', '#0000FF');
  await expect(page.getByText('Mixed', { exact: true })).toBeVisible();
  const swatches = page.getByRole('group', { name: 'Fill values' }).locator('span');
  await expect(swatches).toHaveCount(2);
  await expect(page.locator('input[aria-label="Fill hex"]')).toHaveValue('');
  await expect(page.locator('input[aria-label="Fill opacity"]')).toHaveCount(0);
});

test('B125b layers that share a fill show that fill, with no Mixed label', async ({ page }) => {
  await twoRectangles(page, '#00FF00', '#00FF00');
  await expect(page.getByText('Mixed', { exact: true })).toHaveCount(0);
  await expect(page.locator('input[aria-label="Fill hex"]')).toHaveValue('00FF00');
  await expect(page.locator('input[aria-label="Fill opacity"]')).toBeVisible();
});

test('B125c a colour set on a mixed fill goes to every selected layer, so the row becomes one fill', async ({ page }) => {
  await twoRectangles(page, '#FF0000', '#0000FF');
  const hex = page.locator('input[aria-label="Fill hex"]');
  await hex.fill('#FFAA00');
  await hex.press('Enter');
  await expect(page.getByText('Mixed', { exact: true })).toHaveCount(0);
  await expect(hex).toHaveValue('FFAA00');
  expect(await field(page, 'Fill colour').inputValue()).toBe('#ffaa00');
});
