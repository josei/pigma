/**
 * The mask indicator's other two halves.
 *
 * Figma's source (help.figma.com/hc/en-us/articles/360040450253-Masks): "the mask
 * is shown in the Layers panel with a mask icon AND AN UPWARD-FACING ARROW ON THE
 * MASKED LAYERS", and the canvas outlines are a VIEW OPTION drawn GREEN.
 */
import { test, expect } from '@playwright/test';
import { boot, drawShape } from './helpers';

const arrow = '[data-testid="layer-masked-arrow"]';
const outline = '[data-testid="mask-outline"]';

test('the arrow marks the MASKED layers, not the mask', async ({ page }) => {
  await boot(page);
  // TWO siblings drawn on the page, and only the LOWER one masked — the panel shows
  // children reversed, so the FIRST drawn is the BOTTOM layer and the mask clips the
  // one above it. (Selecting everything and masking would make several masks.)
  await drawShape(page, 'Rectangle', 200, 120);
  await drawShape(page, 'Rectangle', 240, 160);
  // The panel lists the last drawn first, so select the SECOND row (the first drawn).
  await page.locator('.layer-row').nth(1).click();
  await page.keyboard.press('Control+Alt+m');
  await expect(page.locator('[data-testid="layer-mask-badge"]')).toHaveCount(1);

  // The MASK carries the badge and NOT the arrow; the MASKED layers carry the
  // arrow and NOT the badge. With two siblings masked by one mask, that is: one
  // badge, two arrows, and no row carrying both.
  await expect(page.locator('[data-testid="layer-mask-badge"]')).toHaveCount(1);
  const arrows = await page.locator(arrow).count();
  expect(arrows, 'no masked layer got the arrow').toBeGreaterThan(0);
  // No row carries both marks.
  const both = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.layer-row')];
    return rows.filter(
      (row) =>
        row.querySelector('[data-testid="layer-masked-arrow"]') &&
        row.querySelector('[data-testid="layer-mask-badge"]'),
    ).length;
  });
  expect(both, 'a row carries both the mask badge and the masked arrow').toBe(0);
});

test('the outline appears on the mask, is GREEN, and the toggle toggles it', async ({ page }) => {
  await boot(page);
  await drawShape(page, 'Rectangle', 200, 120);
  await drawShape(page, 'Rectangle', 240, 160);
  await page.locator('.layer-row').nth(1).click();
  await page.keyboard.press('Control+Alt+m');

  // OFF by default, like Figma's View option.
  await expect(page.locator(outline), 'mask outlines were on by default').toHaveCount(0);

  await page.getByRole('button', { name: /menu/i }).first().click();
  await page.getByRole('button', { name: 'Mask outlines' }).click();
  await expect.poll(async () => page.locator(outline).count(), { timeout: 5000 }).toBeGreaterThan(0);

  // GREEN, and DASHED — a different mark from the selection's solid purple.
  const stroke = await page.locator(outline).first().getAttribute('stroke');
  expect(stroke, 'the mask outline is not green').toBe('#0acf83');
  const dash = await page.locator(outline).first().getAttribute('stroke-dasharray');
  expect(dash, 'the mask outline is not dashed').not.toBeNull();

  // The outline is on the MASK only: one mask, one outline.
  const badges = await page.locator('[data-testid="layer-mask-badge"]').count();
  expect(await page.locator(outline).count()).toBe(badges);

  // And the toggle TOGGLES: off again, gone.
  await page.getByRole('button', { name: /menu/i }).first().click();
  await page.getByRole('button', { name: 'Mask outlines' }).click();
  await expect.poll(async () => page.locator(outline).count(), { timeout: 5000 }).toBe(0);
});
