/**
 * The Overlap row in the Auto layout section: a stack with a negative gap chooses whether its later or its earlier overlapping
 * child is on top. Sketch's Florence release describes "the z-index order of overlapping items". The paint is pixel-tested
 * (stackOrder.test.ts); this drives the live panel, reads the choice from the store, and checks it is one undo step.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, nextPaint } from './helpers';

/** The overlap order the store holds on the first top-level frame, or undefined when unset. */
async function overlapOf(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const store = window.__pigmaStore;
    if (!store) throw new Error('window.__pigmaStore is not exposed');
    const frame = store.getState().file.document.children[0]!.children[0] as { autoLayout?: { overlapOrder?: string } };
    return frame.autoLayout?.overlapOrder;
  });
}

/** A row frame with two rectangles overlapping by a 40-unit negative gap, and the frame selected. */
async function overlappingRow(page: Page) {
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
    });
  });
  await nextPaint(page);
  await drawShape(page, 'Rectangle', 100, 80, -60, 0);
  await drawShape(page, 'Rectangle', 100, 80, 40, 0);
  await page.evaluate(() => {
    const store = window.__pigmaStore!;
    const frame = store.getState().file.document.children[0]!.children[0] as { id: string };
    store.getState().select([frame.id], 'replace');
  });
  await nextPaint(page);
}

test('B166a the Overlap row sets which overlapping child is on top, and one undo puts it back', async ({ page }) => {
  await overlappingRow(page);
  const section = page.locator('.section', { has: page.locator('.section__header', { hasText: 'Auto layout' }) });
  const overlap = section.locator('[role="group"][aria-label="Overlap"]');
  await expect(overlap).toHaveCount(1);
  await expect(overlap.locator('.segmented__option--active')).toHaveText('Later');

  await overlap.locator('.segmented__option', { hasText: 'Earlier' }).click();
  await nextPaint(page);
  expect(await overlapOf(page)).toBe('EARLIER_ON_TOP');
  await expect(overlap.locator('.segmented__option--active')).toHaveText('Earlier');

  // One undo entry: a single undo returns the stack to the default, later children on top.
  await page.keyboard.press('Control+z');
  await nextPaint(page);
  expect(await overlapOf(page)).toBeUndefined();
  await expect(overlap.locator('.segmented__option--active')).toHaveText('Later');
});
