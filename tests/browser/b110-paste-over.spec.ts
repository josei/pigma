/**
 * Paste over selection (Cmd/Ctrl+Shift+V) and Paste to replace (Cmd/Ctrl+Shift+R), from Figma's
 * "Copy and paste objects" Help Center article. The copy lands at the selected layer's x and y;
 * Paste to replace also removes that layer. The model operation is unit-tested (ops.test.ts).
 */
import { test, expect } from '@playwright/test';
import { boot, drawShape, field } from './helpers';

/** A 60-wide rectangle on the left and an 80-wide one on the right, with the left one copied. */
async function twoRectsWithLeftCopied(page: import('@playwright/test').Page) {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 60, 60, -150, 0);
  await drawShape(page, 'Rectangle', 80, 40, 150, 0);
  await page.locator('.layer-row', { hasText: 'Rectangle 1' }).first().click();
  await page.keyboard.press('Control+c');
}

const rectRows = (page: import('@playwright/test').Page) => page.locator('.layer-row', { hasText: 'Rectangle' });

test('B110a Paste over selection lands the copy at the selected layer\'s x and y, and keeps that layer', async ({ page }) => {
  await twoRectsWithLeftCopied(page);
  await page.locator('.layer-row', { hasText: 'Rectangle 2' }).first().click();
  const targetX = Number(await field(page, 'X').inputValue());
  const targetY = Number(await field(page, 'Y').inputValue());

  await page.keyboard.press('Control+Shift+v');
  await expect(rectRows(page)).toHaveCount(3);
  expect(Number(await field(page, 'X').inputValue())).toBeCloseTo(targetX, 0);
  expect(Number(await field(page, 'Y').inputValue())).toBeCloseTo(targetY, 0);
  expect(Number(await field(page, 'W').inputValue()), 'the copy is the 60-wide rectangle that was copied').toBe(60);
});

test('B110b Paste to replace puts the copy where the selected layer was and removes that layer', async ({ page }) => {
  await twoRectsWithLeftCopied(page);
  await page.locator('.layer-row', { hasText: 'Rectangle 2' }).first().click();
  const targetX = Number(await field(page, 'X').inputValue());

  await page.keyboard.press('Control+Shift+r');
  await expect(rectRows(page)).toHaveCount(2);
  expect(Number(await field(page, 'X').inputValue())).toBeCloseTo(targetX, 0);
  expect(Number(await field(page, 'W').inputValue()), 'the 80-wide rectangle was replaced by the 60-wide copy').toBe(60);
});

test('B110c Paste over with nothing selected says what to do and adds nothing', async ({ page }) => {
  await twoRectsWithLeftCopied(page);
  await page.locator('.canvas').first().click({ position: { x: 10, y: 10 } });

  await page.keyboard.press('Control+Shift+v');
  await expect(page.locator('.toast, [role="status"]').filter({ hasText: 'Select a layer to paste over' })).toBeVisible();
  await expect(rectRows(page)).toHaveCount(2);
});

/** Three rectangles: a 60-wide one copied, and two 80-wide ones selected together from the layers panel. */
async function threeRectsWithTwoSelected(page: import('@playwright/test').Page) {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 60, 60, -150, 0);
  await drawShape(page, 'Rectangle', 80, 40, 150, 0);
  await drawShape(page, 'Rectangle', 80, 40, 150, 120);
  await page.locator('.layer-row', { hasText: 'Rectangle 1' }).first().click();
  await page.keyboard.press('Control+c');
  // The layers panel lists the newest layer first, so Rectangle 3 then Shift-click Rectangle 2 selects both.
  await page.locator('.layer-row', { hasText: 'Rectangle 3' }).first().click();
  await page.locator('.layer-row', { hasText: 'Rectangle 2' }).first().click({ modifiers: ['Shift'] });
  await expect(page.getByText('2 layers selected')).toBeVisible();
}

test('B110d Paste over with several layers selected puts a copy on each of them', async ({ page }) => {
  await threeRectsWithTwoSelected(page);
  await page.keyboard.press('Control+Shift+v');
  await expect(rectRows(page)).toHaveCount(5);
  await expect(page.getByText('2 layers selected'), 'the two copies are the new selection').toBeVisible();
  expect(Number(await field(page, 'W').inputValue()), 'the copy is the 60-wide rectangle that was copied').toBe(60);
});

test('B110e Paste to replace with several layers selected replaces each of them', async ({ page }) => {
  await threeRectsWithTwoSelected(page);
  await page.keyboard.press('Control+Shift+r');
  await expect(rectRows(page)).toHaveCount(3);
  await expect(page.getByText('2 layers selected')).toBeVisible();
  expect(Number(await field(page, 'W').inputValue())).toBe(60);
});

