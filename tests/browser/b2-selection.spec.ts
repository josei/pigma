import { test, expect } from '@playwright/test';
import { boot, drawShape, clickCanvas, tool } from './helpers';

test('B2a clicking a shape selects it and Escape deselects', async ({ page }) => {
  await boot(page);
  await drawShape(page, 'Rectangle', 200, 120);
  await expect(page.locator('.layer-row--selected')).toHaveCount(1);

  await page.keyboard.press('Escape');
  await expect(page.locator('.layer-row--selected')).toHaveCount(0);

  await clickCanvas(page, 0, 0);
  await expect(page.locator('.layer-row--selected')).toHaveCount(1);
});

test('B2b clicking empty canvas deselects', async ({ page }) => {
  await boot(page);
  await drawShape(page, 'Rectangle', 200, 120);
  await expect(page.locator('.layer-row--selected')).toHaveCount(1);

  await clickCanvas(page, 320, 260);
  await expect(page.locator('.layer-row--selected')).toHaveCount(0);
});

test('B2c shift-click extends the selection', async ({ page }) => {
  await boot(page);
  await drawShape(page, 'Rectangle', 120, 120, -170, 0);
  await drawShape(page, 'Rectangle', 120, 120, 170, 0);
  await tool(page, 'Move').click();

  await page.keyboard.press('Escape');
  await expect(page.locator('.layer-row--selected')).toHaveCount(0);

  await clickCanvas(page, -170, 0);
  await expect(page.locator('.layer-row--selected')).toHaveCount(1);

  await clickCanvas(page, 170, 0, ['Shift']);
  await expect(page.locator('.layer-row--selected')).toHaveCount(2);
});

test('B2d marquee drag selects every enclosed shape on an empty page', async ({ page }) => {
  await boot(page);
  // A fresh page has no frame under the marquee, so the sweep only meets the
  // shapes we draw.
  await page.locator('button[aria-label="Add page"]').click();
  await drawShape(page, 'Rectangle', 100, 100, -170, 0);
  await drawShape(page, 'Rectangle', 100, 100, 170, 0);
  await tool(page, 'Move').click();

  await page.keyboard.press('Escape');
  await expect(page.locator('.layer-row--selected')).toHaveCount(0);

  const box = (await page.locator('.canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx - 260, cy - 120);
  await page.mouse.down();
  await page.mouse.move(cx + 260, cy + 120, { steps: 12 });
  await page.mouse.up();

  await expect(page.locator('.layer-row--selected')).toHaveCount(2);
});

test('B2e clicking a layer row selects that layer on canvas', async ({ page }) => {
  await boot(page);
  await drawShape(page, 'Rectangle', 200, 120);
  const name = await page.locator('.layer-row--selected .layer-row__name').first().textContent();

  await page.keyboard.press('Escape');
  await expect(page.locator('.layer-row--selected')).toHaveCount(0);

  await page.locator('.layer-row', { hasText: name! }).first().click();
  await expect(page.locator('.layer-row--selected')).toHaveCount(1);
});
