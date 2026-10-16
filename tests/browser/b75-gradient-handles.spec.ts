import { test, expect } from '@playwright/test';
import { boot, drawShape, tool } from './helpers';

/** A linear gradient's two ends are handles on the canvas, and dragging one moves it. */
test('B75a dragging the end handle of a linear gradient changes its direction', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 200, 120);
  await tool(page, 'Move').click();
  await page.locator('select[aria-label="Fill type"]').selectOption('LINEAR');
  const end = page.locator('.canvas__overlay circle[fill="#0d99ff"]').first();
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
