/**
 * Resizing a layer snaps the edge the handle moves to a nearby sibling edge, with a guide. Before this a resize handle did not
 * snap at all. The snap is unit-tested (snapEdge in snapping.test.ts); this drives the live canvas.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, docToScreen, drawShape, nextPaint, tool } from './helpers';

/** The page-level boxes of the two rectangles, read from the store (the page is at the origin, so these are absolute). */
const boxes = (page: Page) =>
  page.evaluate(() => {
    const kids = window.__pigmaStore!.getState().file.document.children[0]!.children as Array<{ transform: { tx: number; ty: number }; width: number; height: number }>;
    return kids.map((node) => ({ x: node.transform.tx, y: node.transform.ty, w: node.width, h: node.height }));
  });

test('B152a dragging a layer\'s right handle near a sibling\'s left edge snaps the edge to it, with a guide', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 100, 80, -200, 0);
  await drawShape(page, 'Rectangle', 80, 80, 100, 0);
  await tool(page, 'Move').click();
  await page.locator('.layer-row', { hasText: 'Rectangle 1' }).first().click();
  await nextPaint(page);
  const [first, sibling] = await boxes(page);
  const right = first!.x + first!.w;
  // The handle's edge lands 3 units short of the sibling's left edge, so the sibling's edge is in reach.
  const target = sibling!.x - 3;

  const from = await docToScreen(page, right, first!.y + first!.h / 2);
  const to = await docToScreen(page, target, first!.y + first!.h / 2);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  const guides = await page.locator('.canvas__guide').count();
  await page.mouse.up();
  await nextPaint(page);

  expect(guides).toBeGreaterThan(0);
  const [resized] = await boxes(page);
  expect(resized!.x).toBe(first!.x);
  expect(resized!.x + resized!.w).toBe(sibling!.x);
});
