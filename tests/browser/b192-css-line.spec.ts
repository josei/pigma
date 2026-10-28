/**
 * A line in CSS is one top border on a box of no height, so it renders as one stroke of the layer's weight. The spec takes the CSS the
 * Inspect tab shows, loads it into a bare page, and measures the rendered box. The mapping is unit-tested (codegen.test.ts); this checks
 * the CSS in a browser.
 */
import { test, expect } from '@playwright/test';
import { boot, nextPaint } from './helpers';

test('B192a a line in CSS renders as one stroke of its weight', async ({ page }) => {
  await boot(page, { blank: true });
  await page.locator('.toolbar__button[aria-label="Line"]').click();
  const box = (await page.locator('.canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx - 120, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 120, cy, { steps: 8 });
  await page.mouse.up();
  await nextPaint(page);
  await page.evaluate(() => {
    window.__pigmaStore!.getState().updateSelected(
      { strokes: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 1 }], strokeWeight: 4 } as never,
      'Set stroke',
    );
  });
  await nextPaint(page);

  await page.locator('.tab', { hasText: 'Inspect' }).click();
  await nextPaint(page);
  await page.locator('[aria-label="Show CSS"]').click();
  await nextPaint(page);
  const css = (await page.locator('pre[aria-label="Generated code"]').textContent()) ?? '';
  expect(css).toContain('border-top: 4px solid');

  // The generated class names the layer; the element carries the same class, and renders alone on a blank page.
  const selector = css.match(/^\.([\w-]+) \{/m)![1]!;
  await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body><div class="${selector}"></div></body></html>`);
  const height = await page.locator(`.${selector}`).evaluate((node) => node.getBoundingClientRect().height);
  // A single top border of 4px and no content height: 4px, not the 8px a full border would give.
  expect(height).toBeCloseTo(4, 0);
});
