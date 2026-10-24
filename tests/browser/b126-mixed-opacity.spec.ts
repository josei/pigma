/**
 * The Opacity field for a selection of several layers: when the layers share an opacity the field shows it, and when
 * they differ it is empty and says "Mixed". Typing a value sets every selected layer; leaving the field untouched sets
 * nothing. The rule is unit-tested (isMixedValue in selectionValue.test.ts); this drives the live panel.
 */
import { test, expect } from '@playwright/test';
import { boot, drawShape, field, tool } from './helpers';

/** A rectangle at 40% opacity and a second one at the default 100%, both selected. */
async function twoOpacities(page: import('@playwright/test').Page) {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 120, 90, -120, 0);
  await field(page, 'Opacity').fill('40');
  await field(page, 'Opacity').press('Enter');
  await drawShape(page, 'Rectangle', 120, 90, 120, 0);
  await tool(page, 'Move').click();
  await page.keyboard.press('Control+A');
  await expect(page.getByText('2 layers selected')).toBeVisible();
}

test('B126a a mixed opacity field is empty, shows a dash, and its tooltip says Mixed', async ({ page }) => {
  await twoOpacities(page);
  const opacity = field(page, 'Opacity');
  await expect(opacity).toHaveValue('');
  await expect(opacity).toHaveAttribute('placeholder', '—');
  await expect(opacity).toHaveAttribute('title', 'Mixed');
});

test('B126b typing a value sets every selected layer, so the field shows it with no Mixed placeholder', async ({ page }) => {
  await twoOpacities(page);
  const opacity = field(page, 'Opacity');
  await opacity.fill('70');
  await opacity.press('Enter');
  await expect(opacity).toHaveValue('70');
  await expect(opacity).not.toHaveAttribute('placeholder', '—');
  await expect(opacity).not.toHaveAttribute('title', 'Mixed');
});

test('B126c focusing a mixed field and leaving it changes no layer', async ({ page }) => {
  await twoOpacities(page);
  const opacity = field(page, 'Opacity');
  await opacity.focus();
  await page.keyboard.press('Tab');
  await expect(opacity).toHaveAttribute('placeholder', '—');
  await expect(opacity).toHaveValue('');
});
