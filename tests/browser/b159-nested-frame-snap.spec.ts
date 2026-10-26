/**
 * A child of a frame that sits inside another frame snaps its edge to the outer frame's edge, with a guide. Before this only the
 * parent frame's edges were snap targets, so the child stopped a few units short of the outer frame's edge. The candidates are
 * unit-tested (snapping.test.ts); this drives the live canvas. The frames are entered first, since a press on a child of a
 * top-level frame moves the frame instead.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, docToScreen, drawShape, nextPaint, tool } from './helpers';

/** The child's absolute left and top, summed down the outer, inner and child transforms (the page is at the origin). */
const childBox = (page: Page) =>
  page.evaluate(() => {
    const outer = (window.__pigmaStore!.getState().file.document.children[0]!.children as any[])[0];
    const inner = outer.children[0];
    const child = inner.children[0];
    return {
      outerLeft: outer.transform.tx as number,
      childLeft: (outer.transform.tx + inner.transform.tx + child.transform.tx) as number,
      childTop: (outer.transform.ty + inner.transform.ty + child.transform.ty) as number,
      width: child.width as number,
      height: child.height as number,
      outerId: outer.id as string,
      innerId: inner.id as string,
      childId: child.id as string,
    };
  });

test('B159a a child of a nested frame snaps to the enclosing frame edge, with a guide', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Frame', 400, 300, 0, 0);
  await drawShape(page, 'Frame', 300, 250, 0, 0);
  await drawShape(page, 'Rectangle', 60, 40, 0, 0);
  await tool(page, 'Move').click();
  const before = await childBox(page);
  await page.evaluate(({ outer, inner }: { outer: string; inner: string }) => {
    const state = window.__pigmaStore!.getState();
    state.setEnteredContainer(outer);
    state.setEnteredContainer(inner);
  }, { outer: before.outerId, inner: before.innerId });
  await nextPaint(page);
  await page.evaluate((id: string) => window.__pigmaStore!.getState().select([id], 'replace'), before.childId);
  await nextPaint(page);

  // The child's left edge is dragged to 2 units inside the outer frame's left edge. The inner frame's edge is out of reach.
  const dx = before.outerLeft + 2 - before.childLeft;
  const from = await docToScreen(page, before.childLeft + before.width / 2, before.childTop + before.height / 2);
  const to = await docToScreen(page, before.childLeft + before.width / 2 + dx, before.childTop + before.height / 2);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  const guides = await page.locator('.canvas__guide').count();
  await page.mouse.up();
  await nextPaint(page);

  expect(guides).toBeGreaterThan(0);
  const after = await childBox(page);
  expect(after.childLeft).toBe(after.outerLeft);
});
