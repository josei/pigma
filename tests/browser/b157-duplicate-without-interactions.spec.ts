/**
 * Duplicate without interactions (right-click menu, after Duplicate): the copy has no prototype links, and the original keeps
 * its own. Plain Duplicate keeps the links on the copy. The model is unit-tested (duplicateNodes in ops.test.ts); this drives
 * the live context menu and reads each layer's interactions from the store.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, nextPaint } from './helpers';

/** The interaction count of each top-level layer on the page, in document order. */
async function interactionCounts(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const pageNode = window.__pigmaStore!.getState().file.document.children[0] as unknown as { children: Array<{ interactions?: unknown[] }> };
    return pageNode.children.map((layer) => layer.interactions?.length ?? 0);
  });
}

/** One rectangle with an interaction added through the Prototype tab, selected and right-clicked on the canvas. */
async function linkedRectangle(page: Page) {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 120, 90, 0, 0);
  await page.locator('.tab', { hasText: 'Prototype' }).click();
  await nextPaint(page);
  await page.locator('[aria-label="Add interaction"]').click();
  await nextPaint(page);
  expect(await interactionCounts(page)).toEqual([1]);
  await page.locator('.tab', { hasText: 'Design' }).click();
  await nextPaint(page);
  const box = (await page.locator('.canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  await nextPaint(page);
}

test('B157a Duplicate without interactions adds a copy with no links, and the original keeps its own', async ({ page }) => {
  await linkedRectangle(page);
  await page.getByText('Duplicate without interactions', { exact: true }).click();
  await nextPaint(page);
  expect(await interactionCounts(page)).toEqual([1, 0]);
});

test('B157b plain Duplicate still copies the links', async ({ page }) => {
  await linkedRectangle(page);
  await page.getByText('Duplicate', { exact: true }).click();
  await nextPaint(page);
  expect(await interactionCounts(page)).toEqual([1, 1]);
});
