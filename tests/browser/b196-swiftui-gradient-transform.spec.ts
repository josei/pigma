/**
 * A gradient's transform in the SwiftUI code: the Inspect tab names the LinearGradient's start and end as UnitPoints, moved by the
 * transform, where the untransformed gradient names the leading and trailing edges. The mapping is unit-tested and checked with the
 * Swift compiler (codegen.test.ts); this reads the code the Inspect tab shows.
 */
import { test, expect } from '@playwright/test';
import { boot, drawShape, nextPaint } from './helpers';

test('B196a the Inspect SwiftUI code for a transformed linear gradient names its start and end as UnitPoints', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 120, 80, 0, 0);
  await nextPaint(page);
  await page.evaluate(() => {
    window.__pigmaStore!.getState().updateSelected(
      {
        fills: [
          {
            type: 'GRADIENT_LINEAR',
            gradientStops: [
              { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
              { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
            ],
            opacity: 1,
            gradientTransform: [
              [1, 0, 0.25],
              [0, 1, 0.5],
            ],
          },
        ],
      } as never,
      'Set gradient fill',
    );
  });
  await nextPaint(page);

  await page.locator('.tab', { hasText: 'Inspect' }).click();
  await nextPaint(page);
  await page.locator('[aria-label="Show SwiftUI"]').click();
  await nextPaint(page);
  const code = () => page.locator('pre[aria-label="Generated code"]').textContent();
  await expect.poll(async () => (await code()) ?? '').toContain('startPoint: UnitPoint(x: 0.25, y: 0.5), endPoint: UnitPoint(x: 1.25, y: 0.5)');
});
