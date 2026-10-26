/**
 * Holding Ctrl or Cmd turns snapping off for a resize and for a scale, as it does for a move (B3c). Without the bypass, a
 * dragged edge snaps to a sibling's edge (B152a, B154a); with it, the edge lands where the pointer puts it, and no guide shows.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, bypassKey, docToScreen, drawShape, nextPaint, tool } from './helpers';

const boxes = (page: Page) =>
  page.evaluate(() => {
    const kids = window.__pigmaStore!.getState().file.document.children[0]!.children as Array<{ id: string; transform: { tx: number; ty: number }; width: number; height: number }>;
    return kids.map((node) => ({ id: node.id, x: node.transform.tx, y: node.transform.ty, w: node.width, h: node.height }));
  });

test('B155a a resize with the bypass held lands on the pointer, not on a sibling edge, and shows no guide', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 100, 80, -200, 0);
  await drawShape(page, 'Rectangle', 80, 80, 100, 0);
  await tool(page, 'Move').click();
  await page.locator('.layer-row', { hasText: 'Rectangle 1' }).first().click();
  await nextPaint(page);
  const [first, sibling] = await boxes(page);
  const right = first!.x + first!.w;
  const target = sibling!.x - 3;
  const from = await docToScreen(page, right, first!.y + first!.h / 2);
  const to = await docToScreen(page, target, first!.y + first!.h / 2);

  await page.keyboard.down(bypassKey);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  const guides = await page.locator('.canvas__guide').count();
  await page.mouse.up();
  await page.keyboard.up(bypassKey);
  await nextPaint(page);

  expect(guides).toBe(0);
  const [resized] = await boxes(page);
  expect(resized!.x + resized!.w).toBeCloseTo(target, 0);
  expect(resized!.x + resized!.w).not.toBeCloseTo(sibling!.x, 0);
});

test('B155b a scale with the bypass held lands on the pointer, not on a sibling edge, and shows no guide', async ({ page }) => {
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
  const from = await docToScreen(page, right, midY);
  const to = await docToScreen(page, c!.x - 3, midY);

  await page.keyboard.down(bypassKey);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  const guides = await page.locator('.canvas__guide').count();
  await page.mouse.up();
  await page.keyboard.up(bypassKey);
  await nextPaint(page);

  expect(guides).toBe(0);
  const after = await boxes(page);
  const newRight = Math.max(after[0]!.x + after[0]!.w, after[1]!.x + after[1]!.w);
  expect(newRight).not.toBeCloseTo(c!.x, 0);
  expect(newRight).toBeCloseTo(c!.x - 3, 0);
});
