/**
 * Fill container for a child of an auto layout frame, from the Auto layout child section: the child takes the space its
 * frame leaves it on the chosen axis, and Fixed gives it back its own size. Figma's help article on auto layout says Fill
 * container "can be applied only to child objects of auto layout frames". The rule is unit-tested (setChildFill in
 * autoLayout.test.ts); this drives the live panel and reads the child's size from the store.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, nextPaint } from './helpers';

/** The width and height of the frame's first child and the frame's own padding and spacing, from the store. */
async function geometry(page: Page) {
  return page.evaluate(() => {
    const store = window.__pigmaStore;
    if (!store) throw new Error('window.__pigmaStore is not exposed');
    const frame = (store.getState().file.document.children[0]!.children as unknown as Array<{ width: number; height: number; children: Array<{ width: number; height: number }>; autoLayout: Partial<Record<string, number>> }>)[0]!;
    return {
      frameWidth: frame.width,
      frameHeight: frame.height,
      childWidth: frame.children[1]!.width,
      childHeight: frame.children[1]!.height,
      // A field the frame never set is absent in the store, and the layout treats it as zero.
      padding: {
        paddingLeft: frame.autoLayout.paddingLeft ?? 0,
        paddingRight: frame.autoLayout.paddingRight ?? 0,
        paddingTop: frame.autoLayout.paddingTop ?? 0,
        paddingBottom: frame.autoLayout.paddingBottom ?? 0,
        itemSpacing: frame.autoLayout.itemSpacing ?? 0,
      },
      firstWidth: frame.children[0]!.width,
    };
  });
}

test('B163a Fill container on the width and height of a child fills the frame, and Fixed keeps the size it has', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Frame', 420, 300, 0, 0);
  await page.evaluate(() => {
    const store = window.__pigmaStore!;
    store.getState().setAutoLayout({ layoutMode: 'HORIZONTAL', primaryAxisSizingMode: 'FIXED', counterAxisSizingMode: 'FIXED' });
  });
  await nextPaint(page);
  await drawShape(page, 'Rectangle', 100, 80, -110, -50);
  await drawShape(page, 'Rectangle', 100, 80, 110, 50);
  await page.evaluate(() => {
    const store = window.__pigmaStore!;
    const frame = store.getState().file.document.children[0]!.children[0] as { children: Array<{ id: string }> };
    store.getState().select([frame.children[1]!.id], 'replace');
  });
  await nextPaint(page);

  const section = page.locator('.section', { has: page.locator('.section__header', { hasText: 'Auto layout child' }) });
  await expect(section).toHaveCount(1);
  const before = await geometry(page);
  expect(before.childWidth).toBe(100);

  // Width: Fill takes the frame's free space beside the first child, less the padding and the one gap.
  await section.locator('.segmented__option', { hasText: 'Fill' }).nth(0).click();
  await nextPaint(page);
  const filled = await geometry(page);
  expect(filled.childWidth).toBe(
    filled.frameWidth - filled.padding.paddingLeft - filled.padding.paddingRight - filled.firstWidth - filled.padding.itemSpacing,
  );

  // Height: Fill stretches across the frame's height less its vertical padding.
  await section.locator('.segmented__option', { hasText: 'Fill' }).nth(1).click();
  await nextPaint(page);
  const stretched = await geometry(page);
  expect(stretched.childHeight).toBe(stretched.frameHeight - stretched.padding.paddingTop - stretched.padding.paddingBottom);

  // Fixed keeps the width the child has now, as Figma does: switching is not a reset to the original 100.
  await section.locator('.segmented__option', { hasText: 'Fixed' }).nth(0).click();
  await nextPaint(page);
  expect((await geometry(page)).childWidth).toBe(filled.childWidth);
});
