/**
 * The filled ends are drawn: the Cap control offers Triangle, Diamond and Circle, filled, and a line with one of them gets a filled
 * head at each end on the canvas. The geometry is unit-tested (arrowheads.test.ts, codegen.test.ts); this drives the live panel and
 * the canvas.
 */
import { test, expect } from '@playwright/test';
import { boot, nextPaint } from './helpers';

test('B205a each filled end is stored from the Cap control and draws one filled head per end of a line', async ({ page }) => {
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
  // Other chrome also carries stroke="none", so compare against the count with no filled head.
  const unfilled = () => page.locator('path[stroke="none"]').count();
  await cap.selectOption('NONE');
  await nextPaint(page);
  const baseline = await unfilled();
  const stored = () => page.evaluate(() => (window.__pigmaStore!.getState().file.document.children[0]!.children[0] as unknown as { strokeCap?: string }).strokeCap);

  for (const value of ['TRIANGLE_FILLED', 'DIAMOND_FILLED', 'CIRCLE_FILLED']) {
    await cap.selectOption(value);
    await nextPaint(page);
    expect(await stored()).toBe(value);
    // The two heads are one filled path with a subpath for each end, so the count is one more than with no arrow.
    expect(await unfilled()).toBe(baseline + 1);
    const subpaths = await page.locator('.canvas__svg path[stroke="none"]').evaluateAll((paths) => {
      const filled = paths.map((path) => path.getAttribute('d') ?? '');
      return filled.reduce((most, d) => Math.max(most, (d.match(/M /g) ?? []).length), 0);
    });
    expect(subpaths).toBe(2);
  }
});
