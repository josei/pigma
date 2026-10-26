/**
 * The Selection colours section for a multi-layer selection: each solid colour of the fills and strokes, with how many
 * layers carry it, most used first. A single layer has no section. The counting is unit-tested (selectionColours in
 * paint.test.ts); this drives the live panel.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, nextPaint, tool } from './helpers';

const section = (page: Page) => page.getByTestId('selection-colours');

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

test('B144a a colour shared by layers shows once, with its layer count, most used first', async ({ page }) => {
  await boot(page, { blank: true });
  await filled(page, -240, '#FF0000');
  await filled(page, 0, '#FF0000');
  await filled(page, 240, '#0000FF');
  await selectAll(page);
  await expect(section(page)).toBeVisible();
  const rows = section(page).locator('.prop-row');
  await expect(rows).toHaveCount(2);
  await expect(section(page).getByLabel('Selection colour 1 hex')).toHaveValue('FF0000');
  await expect(rows.nth(0)).toContainText('2 of 3 layers');
  await expect(section(page).getByLabel('Selection colour 2 hex')).toHaveValue('0000FF');
  await expect(rows.nth(1)).toContainText('1 of 3 layers');
});

test('B144b a stroke colour counts with the fills, on the layer that carries it', async ({ page }) => {
  await boot(page, { blank: true });
  await filled(page, -150, '#FF0000');
  await filled(page, 150, '#0000FF');
  await page.getByRole('button', { name: 'Add Stroke' }).click();
  await page.locator('input[aria-label="Stroke hex"]').fill('#FF0000');
  await page.locator('input[aria-label="Stroke hex"]').press('Enter');
  await nextPaint(page);
  await selectAll(page);
  const rows = section(page).locator('.prop-row');
  await expect(section(page).getByLabel('Selection colour 1 hex')).toHaveValue('FF0000');
  await expect(rows.nth(0)).toContainText('2 of 2 layers');
});

test('B144c a single selected layer has no selection colours section', async ({ page }) => {
  await boot(page, { blank: true });
  await filled(page, 0, '#FF0000');
  await expect(section(page)).toHaveCount(0);
});
