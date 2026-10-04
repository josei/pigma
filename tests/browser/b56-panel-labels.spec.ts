import { test, expect } from '@playwright/test';
import { boot, drawShape } from './helpers';

/**
 * The four-up segmented rows must not clip their labels.
 *
 * `.prop-grid--4` holds the boolean row (Union / Subtract / Intersect / Exclude)
 * and the effects add row (Drop / Inner / Layer / Background). Four equal columns
 * clip "Background" — and, at the narrowest supported panel width, three of the
 * boolean labels too — so the grid wraps into as many columns as fit. The panel is
 * resizable, so this checks every width a user can drag to, not just one.
 */
const PANEL_MIN = 180;

test('B56a no label in a four-up row is clipped at any supported panel width', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 160, 160);

  for (const width of [PANEL_MIN, 220, 260, 320, 420]) {
    await page.evaluate((value) => window.__pigmaStore!.getState().setPanelWidth('right', value), width);
    await page.waitForTimeout(250);
    const measured = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('.prop-grid--4 .segmented__option')] as HTMLElement[];
      return {
        count: buttons.length,
        clipped: buttons.filter((button) => button.scrollWidth > button.clientWidth + 1).map((button) => button.textContent?.trim() ?? ''),
        labels: buttons.map((button) => button.textContent?.trim() ?? ''),
      };
    });
    expect(measured.count, 'the boolean and effects rows should both be present').toBe(8);
    expect(measured.labels, 'the effect kinds must be complete').toContain('Background');
    expect(measured.clipped, `clipped at a ${width}px panel`).toEqual([]);
  }
});

test('B56b the widest label still fits at the narrowest panel', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 160, 160);
  await page.evaluate((value) => window.__pigmaStore!.getState().setPanelWidth('right', value), PANEL_MIN);
  await page.waitForTimeout(250);
  const background = page.locator('.prop-grid--4 .segmented__option', { hasText: 'Background' });
  await expect(background).toBeVisible();
  const box = (await background.boundingBox())!;
  const text = await page.evaluate(() => {
    const button = [...document.querySelectorAll('.prop-grid--4 .segmented__option')].find((entry) => entry.textContent?.trim() === 'Background')!;
    const range = document.createRange();
    range.selectNodeContents(button);
    return range.getBoundingClientRect().width;
  });
  // The button is wider than the text it holds, with room for padding.
  expect(box.width).toBeGreaterThan(text);
});
