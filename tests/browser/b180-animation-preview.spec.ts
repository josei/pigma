/**
 * Animation preview: with Preview keys on, the canvas draws the layer at its keys' values for the key time, and the stored layer does
 * not change. Stopping the preview draws the stored value again. The model is unit-tested (animateFile in keyframes.test.ts); this
 * drives the live canvas and panel, and reads the drawn opacity from the SVG.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, nextPaint } from './helpers';

/** The opacities drawn on the canvas, as numbers. */
async function drawnOpacities(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('.canvas svg [opacity]')]
      .map((element) => Number.parseFloat(element.getAttribute('opacity') ?? 'NaN'))
      .filter((value) => Number.isFinite(value)),
  );
}

test('B180a the preview draws the keyed opacity at the key time, and the stored layer is unchanged', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 100, 60, 0, 0);
  await nextPaint(page);

  const section = page.locator('.section', { has: page.locator('.section__header', { hasText: 'Animation' }) });
  const time = section.getByLabel('Key time (ms)', { exact: true });
  // Opacity 100 percent at 500 ms, then 40 percent at 900 ms.
  await time.fill('500');
  await time.press('Enter');
  await section.getByRole('button', { name: 'Key opacity' }).click();
  const opacity = page.locator('input[aria-label="Opacity"]').first();
  await opacity.fill('40');
  await opacity.press('Enter');
  await time.fill('900');
  await time.press('Enter');
  await section.getByRole('button', { name: 'Key opacity' }).click();
  await nextPaint(page);

  // Halfway between 500 and 900 ms: 70 percent, drawn but not stored.
  await time.fill('700');
  await time.press('Enter');
  await section.getByRole('button', { name: 'Preview keys' }).click();
  await nextPaint(page);
  expect(await drawnOpacities(page)).toEqual(expect.arrayContaining([expect.closeTo(0.7, 6)]));
  const stored = await page.evaluate(() => (window.__pigmaStore!.getState().file.document.children[0]!.children[0] as unknown as { opacity: number }).opacity);
  expect(stored).toBeCloseTo(0.4, 6);

  await section.getByRole('button', { name: 'Stop preview' }).click();
  await nextPaint(page);
  const drawn = await drawnOpacities(page);
  expect(drawn.some((value) => Math.abs(value - 0.7) < 1e-6)).toBe(false);
  expect(drawn).toEqual(expect.arrayContaining([expect.closeTo(0.4, 6)]));
});
