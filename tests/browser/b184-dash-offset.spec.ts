/**
 * A dash offset starts the dash pattern partway in: the Offset field sits under the Dash row, and the canvas carries the value
 * as stroke-dashoffset. The geometry is unit-tested (outline.test.ts, svgExport.test.ts); this drives the live panel.
 */
import { test, expect } from '@playwright/test';
import { boot, drawShape, nextPaint } from './helpers';

test('B184a a dash offset moves the dashes along the stroke, and the canvas carries it', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 100, 60, 0, 0);
  await nextPaint(page);
  // A black stroke, so the Dash row and its Offset field appear.
  await page.evaluate(() => {
    window.__pigmaStore!.getState().updateSelected(
      { strokes: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 1 }], strokeWeight: 2 } as never,
      'Set stroke',
    );
  });
  await nextPaint(page);

  await page.getByLabel('Dash pattern', { exact: true }).selectOption('dashed');
  const offset = page.locator('input[aria-label="Offset"]');
  await offset.fill('4');
  await offset.press('Enter');
  await nextPaint(page);

  const stored = await page.evaluate(() => (window.__pigmaStore!.getState().file.document.children[0]!.children[0] as unknown as { dashOffset?: number }).dashOffset);
  expect(stored).toBe(4);
  // The dashed preset is 8 and 4; the rectangle's stroke carries the same pattern and the offset.
  await expect(page.locator('[stroke-dasharray="8 4"]').first()).toHaveAttribute('stroke-dashoffset', '4');
});
