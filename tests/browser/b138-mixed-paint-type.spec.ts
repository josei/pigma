/**
 * The fill and stroke type selects for a selection of several layers: when the layers' paint types differ, the select
 * shows no type and says Mixed; two solids of different colours are one type, so the select still shows Solid. Choosing
 * a type sets every selected layer. The comparison is over paint types, not colours; this drives the live panel.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, nextPaint, tool } from './helpers';

const typeSelect = (page: Page) => page.locator('select[aria-label="Fill type"]');

/** A rectangle with a solid fill of the given colour, or with a linear gradient when a kind is given. */
async function rectangle(page: Page, x: number, options: { hex?: string; kind?: string }) {
  await drawShape(page, 'Rectangle', 120, 90, x, 0);
  if (options.hex) {
    await page.locator('input[aria-label="Fill hex"]').fill(options.hex);
    await page.locator('input[aria-label="Fill hex"]').press('Enter');
  }
  if (options.kind) {
    await typeSelect(page).selectOption(options.kind);
    await nextPaint(page);
  }
}

async function selectBoth(page: Page) {
  await tool(page, 'Move').click();
  await page.keyboard.press('Control+A');
  await expect(page.getByText('2 layers selected')).toBeVisible();
}

test('B138a a solid and a linear fill show no type and say Mixed', async ({ page }) => {
  await boot(page, { blank: true });
  await rectangle(page, -120, {});
  await rectangle(page, 120, { kind: 'LINEAR' });
  await selectBoth(page);
  await expect(typeSelect(page)).toHaveValue('');
  await expect(typeSelect(page)).toHaveAttribute('title', 'Mixed');
});

test('B138b two solids of different colours are one type, so the select still shows Solid', async ({ page }) => {
  await boot(page, { blank: true });
  await rectangle(page, -120, { hex: '#FF0000' });
  await rectangle(page, 120, { hex: '#0000FF' });
  await selectBoth(page);
  await expect(page.getByText('Mixed', { exact: true })).toBeVisible();
  await expect(typeSelect(page)).toHaveValue('SOLID');
  await expect(typeSelect(page)).not.toHaveAttribute('title', 'Mixed');
});

test('B138c a click on a mixed type sets every selected layer, so the first layer alone shows it too', async ({ page }) => {
  await boot(page, { blank: true });
  await rectangle(page, -120, {});
  await rectangle(page, 120, { kind: 'LINEAR' });
  await selectBoth(page);
  await expect(typeSelect(page)).toHaveValue('');
  await typeSelect(page).selectOption('RADIAL');
  await nextPaint(page);
  await expect(typeSelect(page)).toHaveValue('RADIAL');
  await expect(typeSelect(page)).not.toHaveAttribute('title', 'Mixed');
  await page.locator('.layer-row', { hasText: 'Rectangle 1' }).first().click();
  await nextPaint(page);
  await expect(typeSelect(page)).toHaveValue('RADIAL');
});
