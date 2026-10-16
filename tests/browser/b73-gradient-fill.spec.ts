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
