/**
 * A stroke's join is a panel control, and a miter join has a miter limit: a sharp corner longer than the limit is bevelled, and the
 * canvas carries the limit as stroke-miterlimit. The geometry is unit-tested (outline.test.ts, svgExport.test.ts); this drives the
 * live panel.
 */
import { test, expect } from '@playwright/test';
import { boot, drawShape, nextPaint } from './helpers';

test('B185a the join control sets the stroke join, and the miter limit shows only for a miter join', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 100, 60, 0, 0);
  await nextPaint(page);
  // A black stroke, so the Join control and its Miter limit appear.
  await page.evaluate(() => {
    window.__pigmaStore!.getState().updateSelected(
      { strokes: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 1 }], strokeWeight: 2 } as never,
      'Set stroke',
    );
  });
  await nextPaint(page);

  const limit = page.locator('input[aria-label="Miter limit"]');
  await expect(limit).toBeVisible();
  await limit.fill('1.5');
  await limit.press('Enter');
  await nextPaint(page);
  const stored = () => page.evaluate(() => {
    const node = window.__pigmaStore!.getState().file.document.children[0]!.children[0] as unknown as { strokeJoin?: string; strokeMiterLimit?: number };
    return { join: node.strokeJoin, limit: node.strokeMiterLimit };
  });
  expect(await stored()).toEqual({ join: undefined, limit: 1.5 });
  await expect(page.locator('[stroke-miterlimit="1.5"]').first()).toBeAttached();

  await page.getByLabel('Stroke join', { exact: true }).selectOption('BEVEL');
  await nextPaint(page);
  expect((await stored()).join).toBe('BEVEL');
  await expect(limit).toHaveCount(0);
});
