/**
 * Share of the row in a wrapping row, from the Auto layout child section: the child takes a percent of the frame's inner
 * width with no spacing taken out, and the cross-axis share is not offered, since a wrapped line is packed on its children's
 * own heights. The rule is unit-tested (canShareChild and the wrapping case in autoLayout.test.ts); this drives the live panel.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, nextPaint } from './helpers';

/** The frame's inner width and each child's width and primary share, from the store. */
async function row(page: Page) {
  return page.evaluate(() => {
    const frame = window.__pigmaStore!.getState().file.document.children[0]!.children[0] as unknown as {
      width: number;
      autoLayout: Partial<Record<string, number>>;
      children: Array<{ width: number; layoutPercent?: number }>;
    };
    return {
      inner: frame.width - (frame.autoLayout.paddingLeft ?? 0) - (frame.autoLayout.paddingRight ?? 0),
      children: frame.children.map((child) => ({ width: child.width, layoutPercent: child.layoutPercent })),
    };
  });
}

test('B168a a child of a wrapping row takes its percent of the inner width, and no cross share is offered', async ({ page }) => {
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

  await expect(page.getByLabel('Share of height')).toHaveCount(0);
  const share = page.getByLabel('Share of row');
  await expect(share).toHaveCount(1);
  await share.fill('75');
  await share.press('Enter');
  await nextPaint(page);

  const { inner, children } = await row(page);
  expect(children[1]!.layoutPercent).toBe(75);
  expect(children[1]!.width).toBeCloseTo(inner * 0.75, 6);
});
