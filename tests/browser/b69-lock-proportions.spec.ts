import { test, expect } from '@playwright/test';
import { boot, drawShape, field, tool } from './helpers';

/** The W/H lock: with it on, the other dimension follows at the same ratio. */
test('B69a with the lock on, editing width moves the height at the same ratio', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 100, 60);
  await tool(page, 'Move').click();
  await page.locator('button[aria-label="Lock proportions"]').click();
  await expect(page.locator('button[aria-label="Lock proportions"]')).toHaveAttribute('aria-pressed', 'true');
  await field(page, 'W').fill('200');
  await field(page, 'W').press('Enter');
  expect(Number(await field(page, 'H').inputValue()), 'the height did not follow').toBe(120);
});

test('B69b the lock also works from height, and off leaves dimensions independent', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 100, 60);
  await tool(page, 'Move').click();
  await page.locator('button[aria-label="Lock proportions"]').click();
  await field(page, 'H').fill('30');
  await field(page, 'H').press('Enter');
  expect(Number(await field(page, 'W').inputValue())).toBe(50);
  // Off again: width changes alone.
  await page.locator('button[aria-label="Lock proportions"]').click();
  await field(page, 'W').fill('80');
  await field(page, 'W').press('Enter');
  expect(Number(await field(page, 'H').inputValue()), 'the height moved with the lock off').toBe(30);
});
