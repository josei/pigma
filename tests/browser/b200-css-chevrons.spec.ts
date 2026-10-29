/**
 * An arrow line's chevron in CSS: each end is a pseudo-element clipped to a V-shaped band. The spec takes the CSS the Inspect tab shows,
 * renders it in a bare page, and asks the browser for each end's clip path, so a declaration it rejects would show as none. The geometry
 * is unit-tested (codegen.test.ts) and was compared with the canvas by eye.
 */
import { test, expect } from '@playwright/test';
import { boot, nextPaint } from './helpers';

test('B200a the browser accepts the CSS chevron at each end of an arrow line', async ({ page }) => {
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
      { strokes: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1 }], strokeWeight: 6, strokeCap: 'ARROW_LINES' } as never,
      'Set stroke',
    );
  });
  await nextPaint(page);

  await page.locator('.tab', { hasText: 'Inspect' }).click();
  await nextPaint(page);
  await page.locator('[aria-label="Show CSS"]').click();
  await nextPaint(page);
  const css = (await page.locator('pre[aria-label="Generated code"]').textContent()) ?? '';
  const selector = css.match(/^\.([\w-]+) \{/m)![1]!;
  await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body><div class="${selector}"></div></body></html>`);
  const ends = await page.locator(`.${selector}`).evaluate((node) => {
    const before = getComputedStyle(node, '::before');
    const after = getComputedStyle(node, '::after');
    return { beforeWidth: before.width, beforeClip: before.clipPath, afterClip: after.clipPath };
  });
  // The box is the arms' length of 30 plus two weights, 42 across. A rejected declaration computes to none.
  expect(ends.beforeWidth).toBe('42px');
  expect(ends.beforeClip).toContain('polygon');
  expect(ends.afterClip).toContain('polygon');
});
