/**
 * Share of the cross axis, from the Auto layout child section: a child of a row takes a percent of its frame's inner height,
 * and Fill on the height gives the share back. The rule is unit-tested (setChildCounterPercent in autoLayout.test.ts); this
 * drives the live panel and reads the child's height from the store.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, nextPaint } from './helpers';

/** The frame's inner height and each child's height and cross share, from the store. */
async function row(page: Page) {
  return page.evaluate(() => {
    const frame = window.__pigmaStore!.getState().file.document.children[0]!.children[0] as unknown as {
      height: number;
      autoLayout: Partial<Record<string, number>>;
      children: Array<{ height: number; layoutCounterPercent?: number; layoutAlign?: string }>;
    };
    return {
      innerHeight: frame.height - (frame.autoLayout.paddingTop ?? 0) - (frame.autoLayout.paddingBottom ?? 0),
      children: frame.children.map((child) => ({
        height: child.height,
        layoutCounterPercent: child.layoutCounterPercent,
        layoutAlign: child.layoutAlign,
      })),
    };
  });
}

/** A 420 x 300 row with fixed sizes, two 100 x 80 children, and the second child selected. */
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
  await drawShape(page, 'Rectangle', 110, 50, 110, 50);
  await page.evaluate(() => {
    const store = window.__pigmaStore!;
    const frame = store.getState().file.document.children[0]!.children[0] as { children: Array<{ id: string }> };
    store.getState().select([frame.children[1]!.id], 'replace');
  });
  await nextPaint(page);
}

test('B166a a cross share takes its percent of the row height, and the other child keeps its height', async ({ page }) => {
  await rowWithTwoChildren(page);
  const share = page.getByLabel('Share of height');
  await expect(share).toHaveCount(1);
  await share.fill('50');
  await share.press('Enter');
  await nextPaint(page);

  const { innerHeight, children } = await row(page);
  expect(children[1]!.layoutCounterPercent).toBe(50);
  expect(children[1]!.height).toBeCloseTo(innerHeight * 0.5, 6);
  expect(children[0]!.height).toBe(80);
});

test('B166b Fill on the height gives the cross share back, and a cross share gives Fill back', async ({ page }) => {
  await rowWithTwoChildren(page);
  const section = page.locator('.section', { has: page.locator('.section__header', { hasText: 'Auto layout child' }) });
  await page.getByLabel('Share of height').fill('40');
  await page.getByLabel('Share of height').press('Enter');
  await nextPaint(page);
  expect((await row(page)).children[1]!.layoutCounterPercent).toBe(40);

  await section.locator('.segmented__option', { hasText: 'Fill' }).nth(1).click();
  await nextPaint(page);
  const filled = (await row(page)).children[1]!;
  expect(filled.layoutCounterPercent, 'Fill left the cross share set').toBeUndefined();
  expect(filled.layoutAlign).toBe('STRETCH');

  await page.getByLabel('Share of height').fill('30');
  await page.getByLabel('Share of height').press('Enter');
  await nextPaint(page);
  const shared = (await row(page)).children[1]!;
  expect(shared.layoutCounterPercent).toBe(30);
  expect(shared.layoutAlign, 'a cross share left stretch set').toBe('INHERIT');
});
