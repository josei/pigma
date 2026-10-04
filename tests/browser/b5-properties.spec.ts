import { test, expect } from '@playwright/test';
import { boot, drawShape, field, tool } from './helpers';

test('B5a editing W in the properties panel resizes the shape on canvas', async ({ page }) => {
  await boot(page);
  await drawShape(page, 'Rectangle', 200, 120);

  await field(page, 'W').fill('300');
  await field(page, 'W').press('Enter');

  // The selection overlay is in document units; zoom lives on its transform.
  const overlayWidth = Number(await page.locator('.canvas__overlay rect').first().getAttribute('width'));
  expect(overlayWidth).toBeCloseTo(300, 0);
});

test('B5b editing the fill colour repaints the shape', async ({ page }) => {
  await boot(page);
  await drawShape(page, 'Rectangle', 200, 120);

  await field(page, 'Fill colour').fill('#ff0000');
  await field(page, 'Fill colour').press('Enter');

  await expect
    .poll(async () =>
      page.locator('.canvas__svg').evaluate(
        (el) =>
          el.innerHTML.includes('#ff0000') ||
          el.innerHTML.includes('#FF0000') ||
          el.innerHTML.includes('rgb(255, 0, 0)') ||
          el.innerHTML.includes('rgb(255,0,0)'),
      ),
    )
    .toBe(true);
});

test('B5c editing opacity reaches the rendered node', async ({ page }) => {
  await boot(page);
  await drawShape(page, 'Rectangle', 200, 120);

  await field(page, 'Opacity').fill('50');
  await field(page, 'Opacity').press('Enter');

  await expect.poll(async () => Number(await field(page, 'Opacity').inputValue())).toBe(50);
  await expect
    .poll(async () =>
      page.locator('.canvas__svg').evaluate((el) =>
        [...el.querySelectorAll('*')].some((n) => {
          const o = n.getAttribute('opacity') ?? n.getAttribute('fill-opacity');
          return o !== null && Math.abs(Number(o) - 0.5) < 0.01;
        }),
      ),
    )
    .toBe(true);
});

test('B5d renaming a layer updates the layers panel', async ({ page }) => {
  await boot(page);
  await drawShape(page, 'Rectangle', 200, 120);

  await page.locator('.layer-row--selected .layer-row__name').first().dblclick();
  const input = page.locator('.layer-row__rename-input');
  await expect(input).toBeVisible();
  await input.fill('Hero card');
  await input.press('Enter');

  await expect(page.locator('.layer-row', { hasText: 'Hero card' })).toHaveCount(1);
});

test('B5e the properties panel shows geometry for the selection only', async ({ page }) => {
  await boot(page);
  await expect(field(page, 'X')).toHaveCount(0);

  await drawShape(page, 'Rectangle', 200, 120);
  await expect(field(page, 'X')).toHaveCount(1);
  await expect(field(page, 'Y')).toHaveCount(1);
  await expect(field(page, 'W')).toHaveCount(1);
  await expect(field(page, 'H')).toHaveCount(1);

  await tool(page, 'Move').click();
  await page.keyboard.press('Escape');
  await expect(field(page, 'X')).toHaveCount(0);
});
