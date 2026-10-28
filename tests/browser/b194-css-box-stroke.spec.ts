/**
 * A stroked box in CSS: the centred stroke of a rectangle is half outside its edge, so the box that holds it is the rectangle grown by
 * half the weight on each side, drawn border-box. The spec takes the CSS the Inspect tab shows, renders it in a bare page, and measures
 * the outer box against the canvas geometry. The mapping is unit-tested (codegen.test.ts); this checks it in a browser.
 */
import { test, expect } from '@playwright/test';
import { boot, drawShape, nextPaint } from './helpers';

test('B194a a centred stroke in CSS renders its box as the canvas does: 110 by 70 for a 100 by 60 rectangle at weight 10', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 100, 60, 0, 0);
  await nextPaint(page);
  await page.evaluate(() => {
    window.__pigmaStore!.getState().updateSelected(
      { strokes: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 1 }], strokeWeight: 10, strokeAlign: 'CENTER' } as never,
      'Set stroke',
    );
  });
  await nextPaint(page);

  await page.locator('.tab', { hasText: 'Inspect' }).click();
  await nextPaint(page);
  await page.locator('[aria-label="Show CSS"]').click();
  await nextPaint(page);
  const css = (await page.locator('pre[aria-label="Generated code"]').textContent()) ?? '';
  const selector = css.match(/^\.([\w-]+) \{/m)![1]!;
  await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body><div class="${selector}"></div></body></html>`);
  const outer = await page.locator(`.${selector}`).evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { left: rect.left, width: rect.width, height: rect.height };
  });
  // The canvas strokes the edge with half the weight outside it: the outer box is 5 beyond each side, so 110 wide and 70 tall.
  expect(outer.width).toBeCloseTo(110, 0);
  expect(outer.height).toBeCloseTo(70, 0);
  // The box's left is the CSS left, which already sits 5 px beyond the rectangle's own edge.
  expect(outer.left).toBeCloseTo(Number(css.match(/left: (-?[\d.]+)px/)![1]), 0);
});
