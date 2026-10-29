/**
 * Gradients in the CSS the Inspect tab shows: the browser must accept each declaration, or it drops it. An angular fill is a conic
 * gradient and a gradient stroke is a border image, since a border's colour cannot be a gradient. The mapping is unit-tested
 * (codegen.test.ts); this asks the browser to accept the generated CSS.
 */
import { test, expect } from '@playwright/test';
import { boot, drawShape, nextPaint } from './helpers';

test('B198a the browser accepts the conic fill and the border-image stroke the CSS names', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 120, 80, 0, 0);
  await nextPaint(page);
  await page.evaluate(() => {
    window.__pigmaStore!.getState().updateSelected(
      {
        fills: [
          {
            type: 'GRADIENT_ANGULAR',
            gradientStops: [
              { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
              { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
            ],
            opacity: 1,
          },
        ],
        strokes: [
          {
            type: 'GRADIENT_LINEAR',
            gradientStops: [
              { position: 0, color: { r: 0, g: 1, b: 0, a: 1 } },
              { position: 1, color: { r: 0, g: 0, b: 0, a: 1 } },
            ],
            opacity: 1,
          },
        ],
        strokeWeight: 4,
      } as never,
      'Set gradients',
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
  const styles = await page.locator(`.${selector}`).evaluate((node) => {
    const computed = getComputedStyle(node);
    return { background: computed.backgroundImage, borderImage: computed.borderImageSource };
  });
  // A dropped declaration computes to `none`; an accepted one keeps the gradient.
  expect(styles.background).toContain('conic-gradient');
  expect(styles.borderImage).toContain('linear-gradient');
});
