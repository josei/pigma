import { test, expect } from '@playwright/test';
import { boot, drawShape, tool } from './helpers';

/** A linear gradient's two ends are handles on the canvas, and dragging one moves it. */
test('B75a dragging the end handle of a linear gradient changes its direction', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 200, 120);
  await tool(page, 'Move').click();
  await page.locator('select[aria-label="Fill type"]').selectOption('LINEAR');
  const end = page.locator('[data-testid="gradient-handle"][data-handle="end"]');
  await expect(end).toBeVisible();
  const before = await page.evaluate(() => (window.__pigmaStore!.getState().file.document.children[0]!.children[0] as any).fills[0].gradientTransform);
  const box = (await end.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // Drag straight down: the end moves below the start, so the gradient turns towards 90 degrees.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 60, { steps: 6 });
  await page.mouse.up();
  const after = await page.evaluate(() => (window.__pigmaStore!.getState().file.document.children[0]!.children[0] as any).fills[0].gradientTransform);
  expect(JSON.stringify(after), 'dragging the handle did not change the gradient').not.toBe(JSON.stringify(before));
  // The end was at the right edge's middle (1, 0.5) of a 200x120 box. Dragged down 60px it
  // lands at the bottom-right corner (1, 1), so the direction is (1, 0.5): the y part grows,
  // the x part keeps its length.
  expect(after[1][0], 'the end did not move down').toBeCloseTo(0.5, 1);
  expect(after[0][0], 'the end moved sideways').toBeCloseTo(1, 1);
});

/** A radial gradient has a centre handle (moves it) and edge handles (set its width and height). */
test('B75b dragging a radial gradient handle moves its centre and widens it', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 200, 120);
  await tool(page, 'Move').click();
  await page.locator('select[aria-label="Fill type"]').selectOption('RADIAL');
  const centre = page.locator('[data-testid="gradient-handle"][data-handle="centre"]');
  await expect(centre).toBeVisible();
  const c = (await centre.boundingBox())!;
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
  await page.mouse.down();
  await page.mouse.move(c.x + c.width / 2 + 44, c.y + c.height / 2 + 20, { steps: 6 });
  await page.mouse.up();
  const cx = Number(await page.locator('input[aria-label="Centre X"]').inputValue());
  const cy = Number(await page.locator('input[aria-label="Centre Y"]').inputValue());
  expect(cx, 'the centre handle did not move the gradient').toBeGreaterThan(60);
  expect(cy).toBeGreaterThan(55);
  // The right-edge handle is blue; dragging it outward widens the gradient.
  const edge = page.locator('[data-testid="gradient-handle"][data-handle="right"]');
  const e = (await edge.boundingBox())!;
  await page.mouse.move(e.x + e.width / 2, e.y + e.height / 2);
  await page.mouse.down();
  await page.mouse.move(e.x + e.width / 2 + 60, e.y + e.height / 2, { steps: 6 });
  await page.mouse.up();
  const width = Number(await page.locator('input[aria-label="Width"]').inputValue());
  expect(width, 'the edge handle did not widen the gradient').toBeGreaterThan(110);
});
