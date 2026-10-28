/**
 * The generated code for a dashed stroke: the Inspect tab's CSS names a dashed border, and its SwiftUI names the dash pattern and
 * offset in a StrokeStyle. The mapping is unit-tested (codegen.test.ts); this reads the code the Inspect tab shows.
 */
import { test, expect } from '@playwright/test';
import { boot, drawShape, nextPaint } from './helpers';

test('B189a the Inspect code for a dashed stroke names the dashed border, and the SwiftUI dash', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 120, 80, 0, 0);
  await nextPaint(page);
  await page.evaluate(() => {
    window.__pigmaStore!.getState().updateSelected(
      { strokes: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 1 }], strokeWeight: 2, dashPattern: [8, 4], dashOffset: 3 } as never,
      'Set dashed stroke',
    );
  });
  await nextPaint(page);

  await page.locator('.tab', { hasText: 'Inspect' }).click();
  await nextPaint(page);
  const code = () => page.locator('pre[aria-label="Generated code"]').textContent();
  await expect.poll(async () => (await code()) ?? '').toContain('border: 2px dashed');

  await page.locator('[aria-label="Show SwiftUI"]').click();
  await nextPaint(page);
  await expect.poll(async () => (await code()) ?? '').toContain('StrokeStyle(lineWidth: 2, miterLimit: 4, dash: [8, 4], dashPhase: 3)');
});
