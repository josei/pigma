/**
 * Shares in a wrapping row, from the Auto layout child section: the child takes a percent of the frame's inner width, or of its
 * inner height, with no spacing taken out. The rules are unit-tested (the wrapping cases in autoLayout.test.ts); this drives
 * the live panel and reads the child's sizes from the store.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, nextPaint } from './helpers';

/** The frame's inner size and the second child's width and height, from the store. */
async function row(page: Page) {
  return page.evaluate(() => {
    const frame = window.__pigmaStore!.getState().file.document.children[0]!.children[0] as unknown as {
      width: number;
      height: number;
      autoLayout: Partial<Record<string, number>>;
      children: Array<{ width: number; height: number; layoutPercent?: number; layoutCounterPercent?: number }>;
    };
    return {
      innerWidth: frame.width - (frame.autoLayout.paddingLeft ?? 0) - (frame.autoLayout.paddingRight ?? 0),
      innerHeight: frame.height - (frame.autoLayout.paddingTop ?? 0) - (frame.autoLayout.paddingBottom ?? 0),
      second: frame.children[1]!,
    };
  });
}

/** A 420 x 300 wrapping row with fixed sizes, two children, and the second child selected. */
async function wrappingRow(page: Page) {
  await boot(page, { blank: true });
  await drawShape(page, 'Frame', 420, 300, 0, 0);
  await page.evaluate(() => {
    window.__pigmaStore!.getState().setAutoLayout({
      layoutMode: 'HORIZONTAL',
      layoutWrap: 'WRAP',
      primaryAxisSizingMode: 'FIXED',
      counterAxisSizingMode: 'FIXED',
      itemSpacing: 10,
    });
  });
  await nextPaint(page);
  await drawShape(page, 'Rectangle', 100, 80, -110, -50);
  await drawShape(page, 'Rectangle', 110, 50, 110, 50);
  await page.evaluate(() => {
    const store = window.__pigmaStore!;
    const frame = store.getState().file.document.children[0]!.children[0] as { children: Array<{ id: string }> };
    store.getState().select([frame.children[1]!.id], 'replace');
  });
  await nextPaint(page);
}

test('B168a a child of a wrapping row takes its percent of the inner width', async ({ page }) => {
  await wrappingRow(page);
  const share = page.getByLabel('Share of row');
  await expect(share).toHaveCount(1);
  await share.fill('75');
  await share.press('Enter');
  await nextPaint(page);

  const { innerWidth, second } = await row(page);
  expect(second.layoutPercent).toBe(75);
  expect(second.width).toBeCloseTo(innerWidth * 0.75, 6);
});

test('B168b a child of a wrapping row takes its percent of the inner height', async ({ page }) => {
  await wrappingRow(page);
  const share = page.getByLabel('Share of height');
  await expect(share).toHaveCount(1);
  await share.fill('50');
  await share.press('Enter');
  await nextPaint(page);

  const { innerHeight, second } = await row(page);
  expect(second.layoutCounterPercent).toBe(50);
  expect(second.height).toBeCloseTo(innerHeight * 0.5, 6);
});
