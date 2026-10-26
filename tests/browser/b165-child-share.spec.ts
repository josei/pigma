/**
 * Share of the row, from the Auto layout child section: a child takes a percent of its frame's inner width, less the spacing
 * between children, and Fill gives the share back. The rule is unit-tested (setChildPercent in autoLayout.test.ts); this
 * drives the live panel and reads the children's sizes from the store.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, nextPaint } from './helpers';

/** The frame's inner width, its spacing and each child's width and share, from the store. */
async function row(page: Page) {
  return page.evaluate(() => {
    const frame = window.__pigmaStore!.getState().file.document.children[0]!.children[0] as unknown as {
      width: number;
      autoLayout: Partial<Record<string, number>>;
      children: Array<{ width: number; layoutPercent?: number; layoutGrow?: number }>;
    };
    return {
      inner: frame.width - (frame.autoLayout.paddingLeft ?? 0) - (frame.autoLayout.paddingRight ?? 0),
      spacing: frame.autoLayout.itemSpacing ?? 0,
      children: frame.children.map((child) => ({ width: child.width, layoutPercent: child.layoutPercent, layoutGrow: child.layoutGrow })),
    };
  });
}

/** A 420-wide row with a fixed width and 10 spacing, two 100-wide children, and the second child selected. */
async function rowWithTwoChildren(page: Page) {
  await boot(page, { blank: true });
  await drawShape(page, 'Frame', 420, 300, 0, 0);
  await page.evaluate(() => {
    window.__pigmaStore!.getState().setAutoLayout({
      layoutMode: 'HORIZONTAL',
      primaryAxisSizingMode: 'FIXED',
      counterAxisSizingMode: 'FIXED',
      itemSpacing: 10,
    });
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
}

test('B165a a share takes its percent of the row less the spacing, and the other child keeps its width', async ({ page }) => {
  await rowWithTwoChildren(page);
  const share = page.getByLabel('Share of row');
  await expect(share).toHaveCount(1);
  await share.fill('25');
  await share.press('Enter');
  await nextPaint(page);

  const { inner, spacing, children } = await row(page);
  expect(children[1]!.layoutPercent).toBe(25);
  expect(children[1]!.width).toBeCloseTo((inner - spacing) * 0.25, 6);
  expect(children[0]!.width).toBe(100);
});

test('B165b Fill gives the share back, and a share gives Fill back', async ({ page }) => {
  await rowWithTwoChildren(page);
  const section = page.locator('.section', { has: page.locator('.section__header', { hasText: 'Auto layout child' }) });
  await page.getByLabel('Share of row').fill('40');
  await page.getByLabel('Share of row').press('Enter');
  await nextPaint(page);
  expect((await row(page)).children[1]!.layoutPercent).toBe(40);

  await section.locator('.segmented__option', { hasText: 'Fill' }).nth(0).click();
  await nextPaint(page);
  const filled = (await row(page)).children[1]!;
  expect(filled.layoutPercent, 'Fill left the share set').toBeUndefined();
  expect(filled.layoutGrow).toBe(1);

  await page.getByLabel('Share of row').fill('30');
  await page.getByLabel('Share of row').press('Enter');
  await nextPaint(page);
  const shared = (await row(page)).children[1]!;
  expect(shared.layoutPercent).toBe(30);
  expect(shared.layoutGrow, 'a share left Fill set').toBe(0);
});
