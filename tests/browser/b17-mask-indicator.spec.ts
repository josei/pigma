/**
 * The mask indicator, in the layers panel.
 *
 * Figma's own description (help.figma.com/hc/en-us/articles/360040450253-Masks):
 * "The mask is shown in the Layers panel with a mask icon and an upward-facing
 * arrow on the masked layers." This spec covers the ICON ON THE MASK LAYER; the
 * upward arrow on the masked layers and the canvas mask outline (Figma gates that
 * behind View > Mask outlines, drawn in GREEN against the selection's PURPLE) are
 * reported as not built rather than faked.
 */
import { test, expect } from '@playwright/test';
import { boot, drawShape } from './helpers';

const badge = '[data-testid="layer-mask-badge"]';

test('a mask carries a badge beside its name, and only the mask does', async ({ page }) => {
  await boot(page);
  // Two siblings, so "beside its name and not beside its siblings" is meaningful.
  await drawShape(page, 'Rectangle', 200, 120);
  await drawShape(page, 'Rectangle', 260, 180);

  await expect(page.locator(badge), 'no badge before any mask exists').toHaveCount(0);

  // Apply the mask to the SELECTED layer with Figma's shortcut.
  await page.keyboard.press('Control+Alt+m');
  await expect(page.locator(badge), 'the mask has no badge').toHaveCount(1);

  // And it is inside the MASK's row, not a sibling's: the badge's row is the one
  // whose mask action reports pressed.
  const pressed = page.locator('.layer-row__action[aria-pressed="true"]');
  await expect(pressed).toHaveCount(1);
  const maskRow = page.locator('.layer-row').filter({ has: page.locator('.layer-row__action[aria-pressed="true"]') });
  await expect(maskRow.locator(badge), 'the badge is not in the mask row').toHaveCount(1);

  // Removing the mask removes the badge — the indicator follows the state, and the
  // state has exactly one source (the node's isMask).
  await page.keyboard.press('Control+Alt+m');
  await expect(page.locator(badge), 'the badge outlived the mask').toHaveCount(0);
});

test('the mask badge is not the selection indicator', async ({ page }) => {
  await boot(page);
  await drawShape(page, 'Rectangle', 200, 120);
  await drawShape(page, 'Rectangle', 260, 180);
  await page.keyboard.press('Control+Alt+m');

  // Selection is a row CLASS; the mask badge is a separate element. Selecting and
  // deselecting must not change the badge, and the badge must not be what marks
  // selection.
  const selected = page.locator('.layer-row--selected');
  const selectedBefore = await selected.count();
  await expect(page.locator(badge)).toHaveCount(1);

  await page.keyboard.press('Escape');
  await expect(page.locator(badge), 'deselecting removed the mask badge').toHaveCount(1);
  expect(await selected.count(), 'the selection indicator did not clear').toBeLessThan(selectedBefore);
  // The two marks are DIFFERENT elements, so they cannot be confused: the badge is
  // not rendered by the selection path, and the selection class is not on the badge.
  await expect(page.locator(`${badge}.layer-row--selected`)).toHaveCount(0);
});
