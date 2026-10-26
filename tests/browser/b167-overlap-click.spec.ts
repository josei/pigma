/**
 * A click on the overlap of a stack set to Earlier on top selects the child that is drawn on top, the earlier one. Before this, the
 * paint followed the Overlap setting but a click still took the later child, so the picture and the click disagreed. The rule is
 * unit-tested (hitTestChild in tree.test.ts); this clicks the live canvas and reads the selection from the store.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, docToScreen, drawShape, nextPaint } from './helpers';

/** A row frame of two 100-wide rectangles overlapping by 40 units, the frame entered and the overlap set to Earlier. */
async function earlierOnTopRow(page: Page) {
  await boot(page, { blank: true });
  await drawShape(page, 'Frame', 300, 100, 0, 0);
  await page.evaluate(() => {
    window.__pigmaStore!.getState().setAutoLayout({
      layoutMode: 'HORIZONTAL',
      primaryAxisSizingMode: 'FIXED',
      counterAxisSizingMode: 'FIXED',
      paddingLeft: 0,
      paddingRight: 0,
      paddingTop: 0,
      paddingBottom: 0,
      itemSpacing: -40,
      overlapOrder: 'EARLIER_ON_TOP',
    });
  });
  await nextPaint(page);
  await drawShape(page, 'Rectangle', 100, 80, -60, 0);
  await drawShape(page, 'Rectangle', 100, 80, 40, 0);
  await nextPaint(page);
}

test('B167a a click on the overlap of an Earlier-on-top stack selects the earlier child, the one drawn on top', async ({ page }) => {
  await earlierOnTopRow(page);
  // The children of a top-level frame are reached once it is entered (B159), so enter it before clicking.
  const ids = await page.evaluate(() => {
    const store = window.__pigmaStore!;
    const frame = store.getState().file.document.children[0]!.children[0] as unknown as {
      id: string;
      transform: { tx: number; ty: number };
      children: Array<{ id: string; transform: { tx: number; ty: number }; width: number }>;
    };
    store.getState().setEnteredContainer(frame.id);
    store.getState().clearSelection();
    const [first, second] = frame.children as [typeof frame.children[0], typeof frame.children[0]];
    return {
      first: first.id,
      // Inside both rectangles: the second starts 40 units into the first, so x 45 is in the overlap.
      point: { x: frame.transform.tx + second.transform.tx + 5, y: frame.transform.ty + second.transform.ty + 40 },
    };
  });
  await nextPaint(page);
  const at = await docToScreen(page, ids.point.x, ids.point.y);
  await page.mouse.click(at.x, at.y);
  await nextPaint(page);
  expect(await page.evaluate(() => window.__pigmaStore!.getState().selection)).toEqual([ids.first]);
});
