import { test, expect } from '@playwright/test';
import { boot, drawShape, field } from './helpers';

/** Enter in a property field hands the keyboard back: the next key is a shortcut. */
test('B65a Enter in a property field leaves it, so the next key is a shortcut', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 160, 120);
  await page.locator('.rail__button[aria-label="Layers"]').click();
  await field(page, 'Rotation').fill('45');
  await field(page, 'Rotation').press('Enter');
  await expect(field(page, 'Rotation'), 'the field kept focus after Enter').not.toBeFocused();
  await page.keyboard.press('t');
  await expect(page.locator('[role="toolbar"]').getByRole('button', { name: 'Text' })).toHaveAttribute('aria-pressed', 'true');
});

/** Right-clicking a layer row acts on that layer, as Figma's layers list does. */
test('B65b right-clicking a layer row selects it and opens the node menu', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 160, 120);
  await drawShape(page, 'Ellipse', 200, 140, 300, 0);
  await page.locator('.rail__button[aria-label="Layers"]').click();
  const rows = page.locator('.layer-row');
  await rows.nth(1).click({ button: 'right' });
  await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();
  await expect(page.locator('[data-testid="context-menu"] [data-testid="context-menu-item"]', { hasText: 'Use as mask' })).toHaveCount(1);
  await expect(rows.nth(1)).toHaveClass(/layer-row--selected/);
});

test('B65c right-clicking inside an already selected group keeps the multi-selection', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 160, 120);
  await drawShape(page, 'Ellipse', 200, 140, 300, 0);
  await page.locator('.rail__button[aria-label="Layers"]').click();
  await page.keyboard.press('Control+a');
  await page.locator('.layer-row').nth(0).click({ button: 'right' });
  const selected = await page.evaluate(() => window.__pigmaStore!.getState().selection.length);
  expect(selected, 'right-click dropped the multi-selection').toBe(2);
});

test('B65d a right-click on a panel that is not layers or canvas opens no menu', async ({ page }) => {
  await boot(page, { blank: true });
  await page.locator('.rail__button[aria-label="Assets"]').click();
  await page.locator('.app__left .section__header').first().click({ button: 'right' });
  await expect(page.locator('[data-testid="context-menu"]')).toHaveCount(0);
});
