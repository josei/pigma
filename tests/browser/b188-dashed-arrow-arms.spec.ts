/**
 * A dashed stroke dashes the arms of an arrow line as well as the line: the arms are a path of their own on the canvas, and carry the
 * same stroke-dasharray. The geometry is unit-tested (outline.test.ts, svgExport.test.ts); this drives the live panel.
 */
import { test, expect } from '@playwright/test';
import { boot, nextPaint } from './helpers';

test('B188a a dashed arrow line dashes its arms on the canvas', async ({ page }) => {
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

  await page.getByLabel('Stroke cap', { exact: true }).selectOption('ARROW_LINES');
  await page.getByLabel('Dash pattern', { exact: true }).selectOption('dashed');
  await nextPaint(page);
  const dash = await page.evaluate(() => (window.__pigmaStore!.getState().file.document.children[0]!.children[0] as unknown as { dashPattern?: number[] }).dashPattern);
  expect(dash).toEqual([8, 4]);
  // The arms are an unfilled path carrying the dash pattern.
  await expect(page.locator('path[stroke-dasharray="8 4"][fill="none"]').first()).toBeAttached();
});
