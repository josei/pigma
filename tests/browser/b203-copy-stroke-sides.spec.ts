/**
 * Copy Properties carries a layer's per-side stroke weights: the top, right, bottom and left widths the canvas draws. The round trip is
 * driven through the store's copy and paste actions, the same ones the shortcut and the menu call.
 */
import { test, expect } from '@playwright/test';
import { boot, drawShape, nextPaint } from './helpers';

test('B203a copy and paste properties carry per-side stroke weights to another layer', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 100, 60, -120, 0);
  await drawShape(page, 'Rectangle', 100, 60, 120, 0);
  await nextPaint(page);
  await page.evaluate(() => {
    const store = window.__pigmaStore!;
    const [first, second] = store.getState().file.document.children[0]!.children as unknown as Array<{ id: string }>;
    store.getState().select([first!.id], 'replace');
    store.getState().updateSelected(
      { strokes: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1 }], individualStrokeWeights: { top: 1, right: 2, bottom: 3, left: 4 } } as never,
      'Set side weights',
    );
    store.getState().copyProperties();
    store.getState().select([second!.id], 'replace');
    store.getState().pasteProperties();
  });
  await nextPaint(page);
  const sides = await page.evaluate(() => (window.__pigmaStore!.getState().file.document.children[0]!.children[1] as unknown as { individualStrokeWeights?: unknown }).individualStrokeWeights);
  expect(sides).toEqual({ top: 1, right: 2, bottom: 3, left: 4 });
});
