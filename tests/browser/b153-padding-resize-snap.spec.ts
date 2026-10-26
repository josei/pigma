/**
 * Resizing a child of an auto layout frame snaps its moved edge to the frame's padding line, with a guide. A drag of such a child
 * only reorders it, so the padding lines are reached by a resize alone. The frame is a fixed-width row, so its padding line
 * stays where it is while the child grows. The candidates are unit-tested (snapping.test.ts); this drives the live canvas.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, docToScreen, drawShape, nextPaint } from './helpers';

/** The frame and its one child, read from the store: a child's transform is relative to its frame. */
const frameAndChild = (page: Page) =>
  page.evaluate(() => {
    const kids = window.__pigmaStore!.getState().file.document.children[0]!.children as any[];
    const frame = kids.find((node) => node.type === 'FRAME');
    const child = frame.children[0];
    return {
      frameX: frame.transform.tx as number,
      frameY: frame.transform.ty as number,
      frameWidth: frame.width as number,
      frameHeight: frame.height as number,
      paddingRight: (frame.autoLayout?.paddingRight ?? 0) as number,
      childX: child.transform.tx as number,
      childY: child.transform.ty as number,
      childWidth: child.width as number,
      childHeight: child.height as number,
    };
  });

test('B153a resizing a child of a fixed-width auto layout row snaps its right edge to the padding line, with a guide', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Frame', 400, 200, 0, 0);
  const autoLayout = page.locator('.section', { has: page.locator('.section__header', { hasText: 'Auto layout' }) });
  await autoLayout.locator('.segmented__option', { hasText: 'Row' }).click();
  await nextPaint(page);
  await page.locator('.segmented[aria-label="Width"]').locator('.segmented__option', { hasText: 'Fixed' }).click();
  await nextPaint(page);
  await drawShape(page, 'Rectangle', 80, 50, 0, 0);
  await page.evaluate(() => {
    const kids = window.__pigmaStore!.getState().file.document.children[0]!.children as Array<{ id: string; type: string }>;
    window.__pigmaStore!.getState().setEnteredContainer(kids.find((node) => node.type === 'FRAME')!.id);
  });
  await page.locator('.layer-row', { hasText: 'Rectangle 1' }).first().click();
  await nextPaint(page);

  const before = await frameAndChild(page);
  const paddingLine = before.frameX + before.frameWidth - before.paddingRight;
  const childRight = before.frameX + before.childX + before.childWidth;
  // The child's right edge is dragged to 3 units short of the padding line, so the line is in reach.
  const midY = before.frameY + before.childY + before.childHeight / 2;
  const from = await docToScreen(page, childRight, midY);
  const to = await docToScreen(page, paddingLine - 3, midY);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  const guides = await page.locator('.canvas__guide').count();
  await page.mouse.up();
  await nextPaint(page);

  expect(guides).toBeGreaterThan(0);
  const after = await frameAndChild(page);
  expect(after.frameX + after.childX + after.childWidth).toBe(paddingLine);
  expect(after.frameWidth).toBe(before.frameWidth);
});
