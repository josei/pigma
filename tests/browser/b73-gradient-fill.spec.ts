import { test, expect } from '@playwright/test';
import { boot, drawShape, tool } from './helpers';

const fillOf = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const node = window.__pigmaStore!.getState().file.document.children[0]!.children[0] as any;
    return node.fills[0];
  });

/** A fill can be solid, or a linear or radial gradient with two colour stops. */
test('B73a the fill type switches between solid, linear and radial', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 160, 120);
  await tool(page, 'Move').click();
  const type = page.locator('select[aria-label="Fill type"]');
  await type.selectOption('LINEAR');
  expect((await fillOf(page)).type).toBe('GRADIENT_LINEAR');
  expect((await fillOf(page)).gradientStops).toHaveLength(2);
  // Drawn, not just stored: the canvas emits a gradient for the fill.
  await expect.poll(() => page.locator('.canvas__svg linearGradient').count()).toBeGreaterThan(0);
  await type.selectOption('RADIAL');
  expect((await fillOf(page)).type).toBe('GRADIENT_RADIAL');
  await type.selectOption('SOLID');
  expect((await fillOf(page)).type).toBe('SOLID');
});

test('B73b a gradient stop colour is editable and sets that stop only', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 160, 120);
  await tool(page, 'Move').click();
  await page.locator('select[aria-label="Fill type"]').selectOption('LINEAR');
  const stop1 = page.locator('input[aria-label="Fill stop 1 colour"]');
  await expect(stop1).toBeVisible();
  await stop1.fill('#ff0000');
  const fill = await fillOf(page);
  expect(fill.gradientStops[0].color.r).toBeCloseTo(1, 2);
  expect(fill.gradientStops[0].color.g).toBeCloseTo(0, 2);
  // The second stop keeps its own colour and its transparency.
  expect(fill.gradientStops[1].color.a).toBe(0);
});

test('B73c the angle turns a linear gradient, and a stop position moves its stop', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 160, 120);
  await tool(page, 'Move').click();
  await page.locator('select[aria-label="Fill type"]').selectOption('LINEAR');
  // Turned to 90 degrees, the gradient runs top to bottom: its x axis points down.
  await page.locator('input[aria-label="Angle"]').fill('90');
  await page.locator('input[aria-label="Angle"]').press('Enter');
  const matrix = await page.locator('.canvas__svg linearGradient').first().getAttribute('gradientTransform');
  const [a, b] = (matrix ?? '').replace(/matrix\(|\)/g, '').trim().split(/\s+/).map(Number);
  expect(Math.abs((a ?? 1) - 0), 'the gradient did not turn').toBeLessThan(0.01);
  expect(Math.abs((b ?? 0) - 1), 'the gradient did not turn').toBeLessThan(0.01);
  // Stop 2 moved to 50%: its offset in the drawn gradient follows.
  await page.locator('input[aria-label="Stop 2"]').fill('50');
  await page.locator('input[aria-label="Stop 2"]').press('Enter');
  await expect.poll(() => page.locator('.canvas__svg linearGradient stop').nth(1).getAttribute('offset')).toBe('50%');
});

test('B73d a radial gradient can be moved and resized', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 160, 120);
  await tool(page, 'Move').click();
  await page.locator('select[aria-label="Fill type"]').selectOption('RADIAL');
  // Centre X at 25%: the gradient's transform moves its origin by a quarter of the box, left of the default.
  await page.locator('input[aria-label="Centre X"]').fill('25');
  await page.locator('input[aria-label="Centre X"]').press('Enter');
  await expect.poll(() => page.locator('.canvas__svg radialGradient').first().getAttribute('gradientTransform')).toContain('-0.25');
  // Width at 50%: the ellipse's x scale halves.
  await page.locator('input[aria-label="Width"]').fill('50');
  await page.locator('input[aria-label="Width"]').press('Enter');
  await expect.poll(() => page.locator('.canvas__svg radialGradient').first().getAttribute('gradientTransform')).toContain('matrix(0.5 ');
});
