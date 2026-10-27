/**
 * Share of the grid cell, from the Grid cell section: a child of a grid takes a percent of its cell's width, from the start of
 * the cell. The rule is unit-tested (setGridShare in gridLayout.test.ts); this drives the live panel and reads the child's width
 * from the store.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, nextPaint } from './helpers';

/** The grid's first child: its width and its grid cell share, from the store. */
async function firstCell(page: Page) {
  return page.evaluate(() => {
    const frame = window.__pigmaStore!.getState().file.document.children[0]!.children[0] as unknown as {
      children: Array<{ width: number; gridWidthPercent?: number }>;
    };
    return { width: frame.children[0]!.width, gridWidthPercent: frame.children[0]!.gridWidthPercent };
  });
}

test('B169a a grid child takes its percent of its cell width, and the Grid cell section sets it', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Frame', 400, 300, 0, 0);
  await page.evaluate(() => {
    window.__pigmaStore!.getState().setAutoLayout({
      layoutMode: 'GRID',
      gridColumns: [{ type: 'FIXED', value: 200 }, { type: 'FIXED', value: 200 }],
      gridRows: [{ type: 'FIXED', value: 150 }],
      primaryAxisSizingMode: 'FIXED',
      counterAxisSizingMode: 'FIXED',
      paddingTop: 0,
      paddingRight: 0,
      paddingBottom: 0,
      paddingLeft: 0,
    });
  });
  await nextPaint(page);
  await drawShape(page, 'Rectangle', 100, 80, -110, -50);
  await page.evaluate(() => {
    const store = window.__pigmaStore!;
    const frame = store.getState().file.document.children[0]!.children[0] as { children: Array<{ id: string }> };
    store.getState().select([frame.children[0]!.id], 'replace');
  });
  await nextPaint(page);

  await expect(page.locator('.section__header', { hasText: 'Grid cell' })).toHaveCount(1);
  const share = page.getByLabel('Share of cell width');
  await share.fill('50');
  await share.press('Enter');
  await nextPaint(page);

  const cell = await firstCell(page);
  expect(cell.gridWidthPercent).toBe(50);
  expect(cell.width).toBeCloseTo(100, 6);
});
