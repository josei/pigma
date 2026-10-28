/**
 * An arrow line in the React code: its box is one top border, and its arrowheads are an SVG child placed so that they share the
 * stroke's centre line. The spec takes the CSS and the React code the Inspect tab shows, rebuilds the layer in a bare page, and checks
 * that the heads are centred on the rendered stroke. The mapping is unit-tested (codegen.test.ts); this checks it in a browser.
 */
import { test, expect } from '@playwright/test';
import { boot, nextPaint } from './helpers';

test('B193a the React arrowheads of a line sit on the centre of its stroke', async ({ page }) => {
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
  const code = () => page.locator('pre[aria-label="Generated code"]').textContent();
  await page.locator('[aria-label="Show CSS"]').click();
  await nextPaint(page);
  const css = (await code()) ?? '';
  await page.locator('[aria-label="Show React"]').click();
  await nextPaint(page);
  const react = (await code()) ?? '';

  const selector = css.match(/^\.([\w-]+) \{/m)![1]!;
  const d = react.match(/<path d="([^"]+)" fill="[^"]+" stroke="none"/)![1]!;
  const fill = react.match(/<path d="[^"]+" fill="([^"]+)" stroke="none"/)![1]!;
  const svgTop = react.match(/left: 0, top: (-?[\d.]+), overflow/)![1]!;
  await page.setContent(
    `<!doctype html><html><head><style>${css}</style></head><body><div class="${selector}"><svg id="heads" style="position:absolute;left:0;top:${svgTop}px;overflow:visible" width="0" height="0"><path d="${d}" fill="${fill}" stroke="none"/></svg></div></body></html>`,
  );
  const line = await page.locator(`.${selector}`).evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { top: rect.top, border: parseFloat(getComputedStyle(node).borderTopWidth) };
  });
  const heads = await page.locator('#heads path').evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom };
  });
  // The stroke is one border of the layer's weight, and its centre is half that below the box top. The heads are symmetric about the
  // line, so their vertical centre is that same line.
  const strokeCentre = line.top + line.border / 2;
  const headCentre = (heads.top + heads.bottom) / 2;
  expect(line.border).toBeCloseTo(6, 0);
  expect(Math.abs(headCentre - strokeCentre)).toBeLessThan(0.5);
});
