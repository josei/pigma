/**
 * Dragging a child of a frame snaps its edge to the frame's own edge, with a guide. Before this the frame's edges were not
 * snap candidates, so a child dragged to the frame's edge stopped a few units short of it. The candidates are unit-tested
 * (snapping.test.ts); this drives the live canvas.
 *
 * The frame is entered first, as a designer does to reach a child of it: a press on a child of a top-level frame would move
 * the frame instead.
 */
import { test, expect } from '@playwright/test';
import { boot, docToScreen, drawShape, nextPaint, nodeGeometry, tool } from './helpers';

test('B151a a child dragged to within a few units of its frame edge snaps to it, and a guide shows', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Frame', 400, 300, 0, 0);
  await drawShape(page, 'Rectangle', 80, 50, -100, -60);
  await tool(page, 'Move').click();
  await page.evaluate(() => {
    const kids = window.__pigmaStore!.getState().file.document.children[0]!.children as Array<{ id: string; type: string }>;
    window.__pigmaStore!.getState().setEnteredContainer(kids.find((node) => node.type === 'FRAME')!.id);
  });
  await nextPaint(page);
  await page.locator('.layer-row', { hasText: 'Rectangle 1' }).first().click();
  await nextPaint(page);
  const child = await nodeGeometry(page);
  await page.locator('.layer-row', { hasText: 'Frame 1' }).first().click();
  await nextPaint(page);
  const frame = await nodeGeometry(page);
  await page.evaluate(() => {
    const kids = window.__pigmaStore!.getState().file.document.children[0]!.children as Array<{ id: string; type: string }>;
    window.__pigmaStore!.getState().setEnteredContainer(kids.find((node) => node.type === 'FRAME')!.id);
  });
  await page.locator('.layer-row', { hasText: 'Rectangle 1' }).first().click();
  await nextPaint(page);

  // The child's left edge is dragged to 2 units inside the frame's left edge: the frame edge is in reach, so it snaps.
  const from = await docToScreen(page, child.x + child.w / 2, child.y + child.h / 2);
  const to = await docToScreen(page, child.x + child.w / 2 + (frame.x + 2 - child.x), child.y + child.h / 2);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  const guides = await page.locator('.canvas__guide').count();
  await page.mouse.up();
  await nextPaint(page);

  expect(guides).toBeGreaterThan(0);
  const moved = await nodeGeometry(page);
  expect(moved.x).toBe(frame.x);
});
