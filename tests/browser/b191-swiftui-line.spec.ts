/**
 * The SwiftUI code for a line: the Inspect tab names a path with its arrow heads, not a rectangle. The mapping is unit-tested
 * (codegen.test.ts); this reads the code the Inspect tab shows.
 */
import { test, expect } from '@playwright/test';
import { boot, nextPaint } from './helpers';

test('B191a the Inspect SwiftUI code for an equilateral arrow line draws a path with its heads', async ({ page }) => {
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
      { strokes: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 1 }], strokeWeight: 6, strokeCap: 'ARROW_EQUILATERAL' } as never,
      'Set stroke',
    );
  });
  await nextPaint(page);

  await page.locator('.tab', { hasText: 'Inspect' }).click();
  await nextPaint(page);
  await page.locator('[aria-label="Show SwiftUI"]').click();
  await nextPaint(page);
  const code = () => page.locator('pre[aria-label="Generated code"]').textContent();
  await expect.poll(async () => (await code()) ?? '').toContain('ZStack(alignment: .topLeading)');
  await expect.poll(async () => (await code()) ?? '').toContain('path.closeSubpath()');
  await expect.poll(async () => (await code()) ?? '').not.toContain('Rectangle()');
});
