/**
 * Add interaction with several layers selected: the same interaction is added to each of them, as one document change, so
 * one undo removes it from all. The model is unit-tested (addInteractionToNodes in prototype.test.ts); this drives the live
 * panel and reads each layer's interactions from the store.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, nextPaint } from './helpers';

/** The interaction count of each top-level layer on the page, in document order. */
async function interactionCounts(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const store = window.__pigmaStore;
    if (!store) throw new Error('window.__pigmaStore is not exposed');
    const pageNode = (store.getState() as unknown as {
      file: { document: { children: Array<{ children: Array<{ interactions?: unknown[] }> }> } };
      pageId: string;
    }).file.document.children[0]!;
    return pageNode.children.map((layer) => layer.interactions?.length ?? 0);
  });
}

test('B133a Add interaction with two layers selected adds one to each, and one undo removes both', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 120, 90, -120, 0);
  await drawShape(page, 'Rectangle', 120, 90, 120, 0);
  await page.keyboard.press('Control+A');
  await expect(page.getByText('2 layers selected')).toBeVisible();
  expect(await interactionCounts(page)).toEqual([0, 0]);

  await page.locator('.tab', { hasText: 'Prototype' }).click();
  await nextPaint(page);
  await page.locator('[aria-label="Add interaction"]').click();
  await nextPaint(page);
  expect(await interactionCounts(page), 'the interaction was not added to both layers').toEqual([1, 1]);

  // One undo entry, not one per layer: a single undo clears both.
  await page.keyboard.press('Control+z');
  await nextPaint(page);
  expect(await interactionCounts(page), 'one undo left an interaction behind on one layer').toEqual([0, 0]);
});
