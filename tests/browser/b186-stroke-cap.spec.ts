/**
 * The stroke panel has a Cap control: None, Round or Square, which the canvas carries as stroke-linecap. An arrow cap from an
 * import keeps its own option, since Pigma draws arrow caps as butt ends. The mapping is unit-tested (svgExport.test.ts,
 * pdfVector.test.ts); this drives the live panel.
 */
import { test, expect } from '@playwright/test';
import { boot, drawShape, nextPaint } from './helpers';

test('B186a the cap control sets the stroke cap, and the canvas carries it as stroke-linecap', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 100, 60, 0, 0);
  await nextPaint(page);
  await page.evaluate(() => {
    window.__pigmaStore!.getState().updateSelected(
      { strokes: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 1 }], strokeWeight: 6 } as never,
      'Set stroke',
    );
  });
  await nextPaint(page);

  const cap = page.getByLabel('Stroke cap', { exact: true });
  await expect(cap).toHaveValue('NONE');
  await cap.selectOption('ROUND');
  await nextPaint(page);
  const stored = () => page.evaluate(() => (window.__pigmaStore!.getState().file.document.children[0]!.children[0] as unknown as { strokeCap?: string }).strokeCap);
  expect(await stored()).toBe('ROUND');
  await expect(page.locator('[stroke-linecap="round"]').first()).toBeAttached();

  await cap.selectOption('SQUARE');
  await nextPaint(page);
  expect(await stored()).toBe('SQUARE');
  await expect(page.locator('[stroke-linecap="square"]').first()).toBeAttached();
});
