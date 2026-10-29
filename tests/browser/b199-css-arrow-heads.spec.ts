/**
 * An equilateral arrow line in CSS: each head is a pseudo-element clipped to a triangle. The spec takes the CSS the Inspect tab shows,
 * renders it in a bare page, and asks the browser to compute the heads' sizes and clip paths, so a declaration it rejects would show.
 * The geometry is unit-tested (codegen.test.ts).
 */
import { test, expect } from '@playwright/test';
import { boot, nextPaint } from './helpers';

test('B199a the CSS heads of an equilateral line are accepted by the browser at the sized triangles', async ({ page }) => {
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
      { strokes: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 1 }], strokeWeight: 4, strokeCap: 'ARROW_EQUILATERAL' } as never,
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
  const heads = await page.locator(`.${selector}`).evaluate((node) => {
    const before = getComputedStyle(node, '::before');
    const after = getComputedStyle(node, '::after');
    return { beforeWidth: before.width, beforeClip: before.clipPath, afterLeft: after.left, afterClip: after.clipPath };
  });
  // A rejected declaration computes to `none`; an accepted one keeps the head's size and its triangle.
  expect(heads.beforeWidth).toBe('20px');
  expect(heads.beforeClip).toContain('polygon');
  // The line is 240 wide, so the end head starts 20 short of its right end.
  expect(heads.afterLeft).toBe('220px');
  expect(heads.afterClip).toContain('polygon');
});
