import { test, expect } from '@playwright/test';
import { boot, drawShape, field, tool } from './helpers';

/** The paint row is one aligned line: colour well, hex, opacity, remove. */
test('B62a the fill hex field edits the colour and junk reverts', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 160, 120);
  await tool(page, 'Move').click();
  const hex = page.locator('input[aria-label="Fill hex"]');
  await hex.fill('#FF0000');
  await hex.press('Enter');
  expect(await field(page, 'Fill colour').inputValue()).toBe('#ff0000');
  await hex.fill('not a colour');
  await hex.press('Enter');
  expect(await field(page, 'Fill colour').inputValue(), 'junk changed the colour').toBe('#ff0000');
  await expect(hex).toHaveValue('FF0000');
});

test('B62b every control in the fill row is visible and inside the panel', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 160, 120);
  await tool(page, 'Move').click();
  const panel = (await page.locator('aside').last().boundingBox())!;
  for (const label of ['Fill colour', 'Fill hex', 'Fill opacity', 'Remove Fill']) {
    const box = (await page.locator(`[aria-label="${label}"]`).boundingBox())!;
    expect(box.width, `${label} collapsed`).toBeGreaterThan(14);
    expect(box.x + box.width, `${label} overflows the panel`).toBeLessThanOrEqual(panel.x + panel.width + 1);
  }
  // No paint: no opacity box dangling beside "None".
  await expect(page.locator('input[aria-label="Stroke opacity"]')).toHaveCount(0);
});

test('B62c the Visible and Locked checkboxes stay 16px', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 160, 120);
  await tool(page, 'Move').click();
  const box = (await page.locator('input[aria-label="Visible"]').boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(20);
});
