/**
 * A text layer made into a component draws its text, not a solid block. The component container takes no fill from the text
 * (the glyphs are the child's own paint), so neither the component nor an instance of it paints a box behind the text.
 * Before this the container took the text's black fill and drew a box the size of the text. This drives the live canvas.
 */
import { test, expect } from '@playwright/test';
import { boot, clickCanvas, nextPaint, tool } from './helpers';

test('B148a a text component and its instance draw their text, with no black box behind it', async ({ page }) => {
  await boot(page, { blank: true });
  await tool(page, 'Text').click();
  await clickCanvas(page, 0, 0);
  await nextPaint(page);
  if (await page.locator('.text-editor').count()) {
    await page.keyboard.type('Hello');
    await page.keyboard.press('Escape');
  }
  await nextPaint(page);
  await tool(page, 'Create component').click();
  await nextPaint(page);
  await page.locator('.rail__button[aria-label="Assets"]').click();
  await page.locator('.app__left .layer-row').first().dblclick();
  await nextPaint(page);
  await page.locator('.rail__button[aria-label="Layers"]').click();
  await page.keyboard.press('Escape');
  await nextPaint(page);

  const containers = await page.evaluate(() => {
    const kids = window.__pigmaStore!.getState().file.document.children[0]!.children as Array<{ type: string; fills: unknown[]; children?: Array<{ type: string; fills: unknown[] }> }>;
    const component = kids.find((node) => node.type === 'COMPONENT')!;
    const instance = kids.find((node) => node.type === 'INSTANCE')!;
    return { componentFills: component.fills.length, instanceFills: instance.fills.length, childType: component.children![0]!.type };
  });
  expect(containers.childType).toBe('TEXT');
  expect(containers.componentFills).toBe(0);
  expect(containers.instanceFills).toBe(0);

  // The text is drawn, and nothing solid black sits under it: the canvas has no black rectangle at all.
  const drawn = await page.evaluate(() => ({
    texts: Array.from(document.querySelectorAll('.canvas svg text')).filter((t) => t.textContent === 'Hello').length,
    blackRects: Array.from(document.querySelectorAll('.canvas svg rect')).filter((r) => r.getAttribute('fill') === 'rgb(0, 0, 0)').length,
  }));
  expect(drawn.texts).toBeGreaterThanOrEqual(2);
  expect(drawn.blackRects).toBe(0);
});
