/**
 * Resizing a child of a wrapping auto layout row snaps its moved edge to the edge of a child on another line, with a guide. A
 * wrapped line's edges are the edges of its children, so the children are the snap targets; this pins that on the live canvas.
 * The children are read from the store: a child's transform is relative to its frame.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, docToScreen, drawShape, nextPaint } from './helpers';

interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The wrapping frame's children, read from the store, with their absolute boxes. */
const childBoxes = (page: Page): Promise<Box[]> =>
  page.evaluate(() => {
    const kids = window.__pigmaStore!.getState().file.document.children[0]!.children as any[];
    const frame = kids.find((node) => node.type === 'FRAME');
    return frame.children.map((child: any) => ({
      id: child.id as string,
      x: (frame.transform.tx as number) + (child.transform.tx as number),
      y: (frame.transform.ty as number) + (child.transform.ty as number),
      w: child.width as number,
      h: child.height as number,
    }));
  });

test('B204a resizing a child on the second line of a wrapping row snaps its right edge to a child on the first line, with a guide', async ({ page }) => {
  await boot(page, { blank: true });
  // Inside 16 units of padding on each side, 208 is left: two 80-wide children and the 12-unit gap fit, three do not.
  await drawShape(page, 'Frame', 240, 200, 0, 0);
  const autoLayout = page.locator('.section', { has: page.locator('.section__header', { hasText: 'Auto layout' }) });
  await autoLayout.locator('.segmented__option', { hasText: 'Row' }).click();
  await nextPaint(page);
  await page.locator('.segmented[aria-label="Width"]').locator('.segmented__option', { hasText: 'Fixed' }).click();
  await nextPaint(page);
  await page.locator('[aria-label="Wrap"] button').filter({ hasText: /^Wrap$/ }).first().click();
  await nextPaint(page);
  await page.evaluate(() => {
    const kids = window.__pigmaStore!.getState().file.document.children[0]!.children as Array<{ id: string; type: string }>;
    window.__pigmaStore!.getState().setEnteredContainer(kids.find((node) => node.type === 'FRAME')!.id);
  });
  // Three 80-wide children in a 200-wide frame: the third has no room on the first line and wraps to a second line.
  for (let index = 0; index < 3; index += 1) {
    await drawShape(page, 'Rectangle', 80, 50, 0, 0);
    await nextPaint(page);
  }

  const before = await childBoxes(page);
  const firstLine = before.filter((child) => child.y === before[0]!.y);
  const second = before.find((child) => child.y > before[0]!.y)!;
  expect(firstLine.length).toBe(2);
  const sibling = firstLine[1]!;

  // The second-line child's right edge is dragged to 3 units short of the first-line child's right edge, so that edge is in reach.
  const midY = second.y + second.h / 2;
  const from = await docToScreen(page, second.x + second.w, midY);
  const to = await docToScreen(page, sibling.x + sibling.w - 3, midY);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  const guides = await page.locator('.canvas__guide').count();
  await page.mouse.up();
  await nextPaint(page);

  expect(guides).toBeGreaterThan(0);
  const after = (await childBoxes(page)).find((child) => child.id === second.id)!;
  expect(after.x + after.w).toBe(sibling.x + sibling.w);
});
