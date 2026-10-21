import { test, expect } from '@playwright/test';
import { boot, drawShape, nextPaint } from './helpers';

/** Figma's alignment keys: Alt+A aligns the selection's left edges, Alt+W its tops. */
test('B96a Alt+A aligns left edges and Alt+W aligns tops, for the selection', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 80, 80, -120, -40);
  await drawShape(page, 'Rectangle', 60, 60, 120, 60);
  const xs = () => page.evaluate(() => (window.__pigmaStore!.getState().file.document.children[0]!.children as any[]).map((n) => ({ x: Math.round(n.transform.tx), y: Math.round(n.transform.ty) })));
  const before = await xs();
  expect(before[0]!.x).not.toBe(before[1]!.x);

  await page.evaluate(() => {
    const kids = (window.__pigmaStore!.getState().file.document.children[0]!.children as any[]).map((n) => n.id as string);
    window.__pigmaStore!.getState().select(kids);
  });
  await page.keyboard.press('Alt+a');
  await nextPaint(page);
  const left = await xs();
  expect(left[0]!.x, 'Alt+A did not align the left edges').toBe(left[1]!.x);

  await page.keyboard.press('Alt+w');
  await nextPaint(page);
  const top = await xs();
  expect(top[0]!.y, 'Alt+W did not align the tops').toBe(top[1]!.y);
});
