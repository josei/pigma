/**
 * The arrow caps are drawn: the Cap control offers Arrow lines and Arrow equilateral, and a line with an equilateral arrow gets its
 * filled heads on the canvas, while an arrow line gets its arms as a stroke. The geometry is unit-tested (arrowheads.test.ts,
 * svgExport.test.ts); this drives the live panel and the canvas.
 */
import { test, expect } from '@playwright/test';
import { boot, nextPaint } from './helpers';

test('B187a an equilateral arrow draws a filled head at each end of a line, and an arrow line draws its arms', async ({ page }) => {
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
      { strokes: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 1 }], strokeWeight: 6 } as never,
      'Set stroke',
    );
  });
  await nextPaint(page);

  const cap = page.getByLabel('Stroke cap', { exact: true });
  // Other chrome also carries stroke="none", so compare against the count with no arrow.
  const unfilled = () => page.locator('path[stroke="none"]').count();
  await cap.selectOption('NONE');
  await nextPaint(page);
  const baseline = await unfilled();
  const stored = () => page.evaluate(() => (window.__pigmaStore!.getState().file.document.children[0]!.children[0] as unknown as { strokeCap?: string }).strokeCap);

  await cap.selectOption('ARROW_EQUILATERAL');
  await nextPaint(page);
  expect(await stored()).toBe('ARROW_EQUILATERAL');
  // The heads are one filled path on the canvas, so the count is one more than with no arrow.
  expect(await unfilled()).toBe(baseline + 1);

  await cap.selectOption('ARROW_LINES');
  await nextPaint(page);
  expect(await stored()).toBe('ARROW_LINES');
  // Arms are stroked, so the filled head is gone again.
  expect(await unfilled()).toBe(baseline);
});
