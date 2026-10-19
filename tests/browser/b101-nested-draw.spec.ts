/**
 * Drawing over a frame that sits inside another frame. Figma puts the new shape in the
 * innermost frame under the pointer, not the outer one. Measured by moving the inner
 * frame: a child moves with its parent, a sibling does not.
 */
import { test, expect } from '@playwright/test';
import { boot, drawShape, field } from './helpers';

test('B101a a shape drawn inside a frame nested in another frame goes into the inner frame', async ({ page }) => {
  await boot(page);
  await page.locator('button[aria-label="Add page"]').click();
  await drawShape(page, 'Frame', 400, 400);
  await drawShape(page, 'Frame', 200, 200);
  await drawShape(page, 'Rectangle', 60, 30);

  const x = async () => Number(await field(page, 'X').inputValue());
  await page.locator('.layer-row', { hasText: 'Rectangle 1' }).first().click();
  const rectX = await x();

  await page.locator('.layer-row', { hasText: 'Frame 2' }).first().click();
  await page.keyboard.press('Shift+ArrowRight');

  await page.locator('.layer-row', { hasText: 'Rectangle 1' }).first().click();
  expect(await x(), 'the rectangle did not move with the inner frame, so it is not inside it').toBeCloseTo(rectX + 10, 0);
});

test('B101b a shape drawn in the outer frame, outside the inner one, stays in the outer frame', async ({ page }) => {
  await boot(page);
  await page.locator('button[aria-label="Add page"]').click();
  await drawShape(page, 'Frame', 400, 400);
  await drawShape(page, 'Frame', 100, 100);
  // Outside the inner frame (which is centred in the outer one), inside the outer one.
  await drawShape(page, 'Rectangle', 40, 40, 160, 160);

  const x = async () => Number(await field(page, 'X').inputValue());
  await page.locator('.layer-row', { hasText: 'Rectangle 1' }).first().click();
  const rectX = await x();

  await page.locator('.layer-row', { hasText: 'Frame 2' }).first().click();
  await page.keyboard.press('Shift+ArrowRight');

  await page.locator('.layer-row', { hasText: 'Rectangle 1' }).first().click();
  expect(await x(), 'the rectangle moved with the inner frame, so it went into the inner frame').toBeCloseTo(rectX, 0);
});
