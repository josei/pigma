/**
 * Keyboard box selection (Figma's Ctrl/Option+Space): the box opens at the centre of the view,
 * the arrows grow it, Enter selects the layers it touches, and Escape leaves without selecting.
 * While the box is open the arrows do not nudge the selection.
 */
import { test, expect } from '@playwright/test';
import { boot, drawShape, field } from './helpers';

test('B108a Ctrl+Space opens the box, and Escape closes it without changing the selection', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 100, 80, -300, 0);
  await page.locator('.canvas').first().click({ position: { x: 10, y: 10 } });
  await expect(page.locator('.layer-row--selected')).toHaveCount(0);

  await page.keyboard.press('Control+Space');
  await expect(page.getByTestId('keyboard-box')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('keyboard-box')).toHaveCount(0);
  await expect(page.locator('.layer-row--selected'), 'Escape selected something').toHaveCount(0);
});

test('B108b Enter selects the layer the box touches, from the centre of the view', async ({ page }) => {
  await boot(page, { blank: true });
  // A large rectangle covers the centre of the view, so the 1px box starts on top of it.
  await drawShape(page, 'Rectangle', 600, 500);
  await page.locator('.canvas').first().click({ position: { x: 10, y: 10 } });

  await page.keyboard.press('Control+Space');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('keyboard-box'), 'Enter did not close the box').toHaveCount(0);
  await expect(page.locator('.layer-row--selected'), 'the box did not select the layer it touches').toHaveCount(1);
});

test('B108c while the box is open, the arrows grow it and do not nudge the selection', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 200, 120);
  const x0 = Number(await field(page, 'X').inputValue());

  await page.keyboard.press('Control+Space');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Escape');
  expect(Number(await field(page, 'X').inputValue()), 'the arrow nudged the selection while the box was open').toBeCloseTo(x0, 0);
});
