/**
 * Typing a colour in the Selection colours section changes it on every selected layer that shows it: a fill or a stroke,
 * each with its own opacity kept. One undo reverts the whole edit. The matching is unit-tested (recolourPaints in
 * paint.test.ts); this drives the live panel.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, field, nextPaint, tool } from './helpers';

const section = (page: Page) => page.getByTestId('selection-colours');
const rows = (page: Page) => section(page).locator('.prop-row');

/** A rectangle at a horizontal offset, filled with the given colour. */
async function filled(page: Page, x: number, hex: string) {
  await drawShape(page, 'Rectangle', 120, 90, x, 0);
  await page.locator('input[aria-label="Fill hex"]').fill(hex);
  await page.locator('input[aria-label="Fill hex"]').press('Enter');
  await nextPaint(page);
}

async function selectAll(page: Page) {
  await tool(page, 'Move').click();
  await page.keyboard.press('ControlOrMeta+a');
  await nextPaint(page);
}

test('B145a typing a shared colour changes it on every selected layer, and the others keep theirs', async ({ page }) => {
  await boot(page, { blank: true });
  await filled(page, -240, '#FF0000');
  await filled(page, 0, '#FF0000');
  await filled(page, 240, '#0000FF');
  await selectAll(page);
  const hex = section(page).getByLabel('Selection colour 1 hex');
  await hex.fill('00FF00');
  await hex.press('Enter');
  await nextPaint(page);
  await expect(section(page).getByLabel('Selection colour 1 hex')).toHaveValue('00FF00');
  await expect(rows(page).nth(0)).toContainText('2 of 3 layers');
  await expect(section(page).getByLabel('Selection colour 2 hex')).toHaveValue('0000FF');
  await expect(rows(page).nth(1)).toContainText('1 of 3 layers');
});

test('B145b a colour that is a fill on one layer and a stroke on another changes on both, keeping each kind', async ({ page }) => {
  await boot(page, { blank: true });
  await filled(page, -150, '#FF0000');
  await filled(page, 150, '#0000FF');
  await page.getByRole('button', { name: 'Add Stroke' }).click();
  await page.locator('input[aria-label="Stroke hex"]').fill('#FF0000');
  await page.locator('input[aria-label="Stroke hex"]').press('Enter');
  await nextPaint(page);
  await selectAll(page);
  const hex = section(page).getByLabel('Selection colour 1 hex');
  await hex.fill('00FF00');
  await hex.press('Enter');
  await nextPaint(page);
  // The second layer's stroke was red, so it is green now, and its fill stays blue.
  await page.locator('.layer-row', { hasText: 'Rectangle 2' }).first().click();
  await nextPaint(page);
  await expect(field(page, 'Stroke hex')).toHaveValue('00FF00');
  await expect(field(page, 'Fill hex')).toHaveValue('0000FF');
});

test('B145c one undo reverts the whole colour edit', async ({ page }) => {
  await boot(page, { blank: true });
  await filled(page, -240, '#FF0000');
  await filled(page, 0, '#FF0000');
  await selectAll(page);
  const hex = section(page).getByLabel('Selection colour 1 hex');
  await hex.fill('00FF00');
  await hex.press('Enter');
  await nextPaint(page);
  await expect(section(page).getByLabel('Selection colour 1 hex')).toHaveValue('00FF00');
  await page.keyboard.press('ControlOrMeta+z');
  await nextPaint(page);
  await expect(section(page).getByLabel('Selection colour 1 hex')).toHaveValue('FF0000');
  await expect(rows(page).nth(0)).toContainText('2 of 2 layers');
});
