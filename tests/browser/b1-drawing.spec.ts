import { test, expect } from '@playwright/test';
import { boot, drawShape, field, tool, toDoc, clickCanvas } from './helpers';

test('B1a rectangle tool draws a rectangle at the dragged size', async ({ page }) => {
  await boot(page, { blank: true });
  const rows = page.locator('.layer-row');
  const before = await rows.count();

  await drawShape(page, 'Rectangle', 200, 120);

  await expect(rows).toHaveCount(before + 1);
  // Drawing auto-selects the new node, so its geometry is already in the panel.
  await expect(field(page, 'W')).toBeVisible();
  const dw = await toDoc(page, 200);
  const dh = await toDoc(page, 120);
  const w = Number(await field(page, 'W').inputValue());
  const h = Number(await field(page, 'H').inputValue());
  // Zoom is a fitted float, so compare relatively rather than to the pixel.
  expect(Math.abs(w - dw) / dw).toBeLessThan(0.02);
  expect(Math.abs(h - dh) / dh).toBeLessThan(0.02);
  await expect(page.locator('.layer-row--selected')).toHaveCount(1);
});

test('B1b ellipse tool draws an ellipse', async ({ page }) => {
  await boot(page, { blank: true });
  const rows = page.locator('.layer-row');
  const before = await rows.count();
  await drawShape(page, 'Ellipse', 160, 160);
  await expect(rows).toHaveCount(before + 1);
  await expect(page.locator('.canvas__svg ellipse')).not.toHaveCount(0);
});

test('B1c frame tool draws a frame', async ({ page }) => {
  await boot(page, { blank: true });
  const rows = page.locator('.layer-row');
  const before = await rows.count();
  await drawShape(page, 'Frame', 240, 180);
  await expect(rows).toHaveCount(before + 1);
});

test('B1d text tool creates a text node', async ({ page }) => {
  await boot(page, { blank: true });
  const rows = page.locator('.layer-row');
  const before = await rows.count();
  await tool(page, 'Text').click();
  await clickCanvas(page, 0, 0);
  await page.waitForTimeout(200);
  const editor = page.locator('.text-editor');
  if (await editor.count()) {
    await page.keyboard.type('Hello');
    await page.keyboard.press('Escape');
  }
  await expect(rows).toHaveCount(before + 1);
});

test('B1e escape cancels the active tool without creating a node', async ({ page }) => {
  await boot(page);
  const rows = page.locator('.layer-row');
  const before = await rows.count();
  await tool(page, 'Rectangle').click();
  await page.keyboard.press('Escape');
  await clickCanvas(page, 40, 40);
  await expect(rows).toHaveCount(before);
});

test('B1f a click with no drag does not create a node', async ({ page }) => {
  await boot(page);
  const rows = page.locator('.layer-row');
  const before = await rows.count();
  await tool(page, 'Rectangle').click();
  await clickCanvas(page, -60, -60);
  await expect(rows).toHaveCount(before);
});
