/**
 * Scaling a selection snaps the edge its handle moves to a nearby layer's edge, with a guide. Before this the scale handles of a
 * multi-layer selection did not snap, so the selection stopped a few units short of the edge it was dragged to. The snap is the
 * one a resize uses (snapEdge in snapping.test.ts); this drives the live canvas.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, docToScreen, drawShape, nextPaint, tool } from './helpers';

/** Each top-level layer's box, read from the store (the page is at the origin, so these are absolute). */
const boxes = (page: Page) =>
  page.evaluate(() => {
    const kids = window.__pigmaStore!.getState().file.document.children[0]!.children as Array<{ id: string; transform: { tx: number; ty: number }; width: number; height: number }>;
    return kids.map((node) => ({ id: node.id, x: node.transform.tx, y: node.transform.ty, w: node.width, h: node.height }));
  });

test('B154a scaling a selection by its east handle snaps the moved edge to a nearby layer edge, with a guide', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 100, 80, -150, 0);
  await drawShape(page, 'Rectangle', 100, 80, 0, 0);
  await drawShape(page, 'Rectangle', 80, 80, 200, 0);
  await tool(page, 'Move').click();
  const [a, b, c] = await boxes(page);
  await page.evaluate((ids: string[]) => window.__pigmaStore!.getState().select(ids, 'replace'), [a!.id, b!.id]);
  await nextPaint(page);

  const right = Math.max(a!.x + a!.w, b!.x + b!.w);
  const midY = a!.y + a!.h / 2;
  // The selection's east edge is dragged to 3 units short of the third layer's left edge, so that edge is in reach.
  const from = await docToScreen(page, right, midY);
  const to = await docToScreen(page, c!.x - 3, midY);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  const guides = await page.locator('.canvas__guide').count();
  await page.mouse.up();
  await nextPaint(page);

  expect(guides).toBeGreaterThan(0);
  const after = await boxes(page);
  expect(Math.max(after[0]!.x + after[0]!.w, after[1]!.x + after[1]!.w)).toBeCloseTo(c!.x, 0);
});
