/**
 * An angular gradient in the SwiftUI code: the Inspect tab names an AngularGradient from the top of the box, where it used to name a
 * cleared colour. The mapping is unit-tested and checked with the Swift compiler (codegen.test.ts); this reads the code the Inspect
 * tab shows.
 */
import { test, expect } from '@playwright/test';
import { boot, drawShape, nextPaint } from './helpers';

test('B197a the Inspect SwiftUI code for an angular gradient fill names an AngularGradient', async ({ page }) => {
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
      } as never,
      'Set angular fill',
    );
  });
  await nextPaint(page);

  await page.locator('.tab', { hasText: 'Inspect' }).click();
  await nextPaint(page);
  await page.locator('[aria-label="Show SwiftUI"]').click();
  await nextPaint(page);
  const code = () => page.locator('pre[aria-label="Generated code"]').textContent();
  await expect.poll(async () => (await code()) ?? '').toContain('.fill(AngularGradient(gradient: Gradient(stops:');
  await expect.poll(async () => (await code()) ?? '').toContain('startAngle: .degrees(270), endAngle: .degrees(630)');
});
