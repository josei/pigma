/**
 * The uniform Radius field for a selection of several rectangles or frames: when the layers share a radius the field
 * shows it, and when they differ it is empty, shows a dash and says "Mixed" in its tooltip. Typing a value sets every
 * selected layer. The rule is unit-tested (isMixedValue in selectionValue.test.ts); this drives the live panel.
 */
import { test, expect } from '@playwright/test';
import { boot, drawShape, field, tool } from './helpers';

/** A rectangle with a 12px radius and a second one at the default 0, both selected. */
async function twoRadii(page: import('@playwright/test').Page) {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 120, 90, -120, 0);
  await field(page, 'Radius').fill('12');
  await field(page, 'Radius').press('Enter');
  await drawShape(page, 'Rectangle', 120, 90, 120, 0);
  await tool(page, 'Move').click();
  await page.keyboard.press('Control+A');
  await expect(page.getByText('2 layers selected')).toBeVisible();
}

test('B127a a mixed radius field is empty, shows a dash, and its tooltip says Mixed', async ({ page }) => {
  await twoRadii(page);
  const radius = field(page, 'Radius');
  await expect(radius).toHaveValue('');
  await expect(radius).toHaveAttribute('placeholder', '—');
  await expect(radius).toHaveAttribute('title', 'Mixed');
});

test('B127b typing a radius sets every selected layer, so the field shows it with no Mixed state', async ({ page }) => {
  await twoRadii(page);
  const radius = field(page, 'Radius');
  await radius.fill('8');
  await radius.press('Enter');
  await expect(radius).toHaveValue('8');
  await expect(radius).not.toHaveAttribute('placeholder', '—');
  await expect(radius).not.toHaveAttribute('title', 'Mixed');
});

test('B127c leaving a mixed radius untouched changes no layer', async ({ page }) => {
  await twoRadii(page);
  const radius = field(page, 'Radius');
  await radius.focus();
  await page.keyboard.press('Tab');
  await expect(radius).toHaveAttribute('placeholder', '—');
  await expect(radius).toHaveValue('');
});
