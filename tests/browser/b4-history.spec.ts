import { test, expect } from '@playwright/test';
import { boot, drawShape, field, tool, drag, toDoc } from './helpers';

test('B4a undo removes a drawn shape and redo restores it', async ({ page }) => {
  await boot(page, { blank: true });
  const rows = page.locator('.layer-row');
  const before = await rows.count();

  await drawShape(page, 'Rectangle', 200, 120);
  await expect(rows).toHaveCount(before + 1);

  await page.keyboard.press('Control+z');
  await expect(rows).toHaveCount(before);

  await page.keyboard.press('Control+Shift+z');
  await expect(rows).toHaveCount(before + 1);
});

test('B4b undo reverts a move', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 200, 120);
  await tool(page, 'Move').click();

  const x0 = Number(await field(page, 'X').inputValue());
  await drag(page, [0, 0], [80, 0]);
  // A drag commits its history transaction shortly after pointerup.
  await page.waitForTimeout(250);
  expect(Number(await field(page, 'X').inputValue())).not.toBeCloseTo(x0, 0);

  await page.keyboard.press('Control+z');
  expect(Number(await field(page, 'X').inputValue())).toBeCloseTo(x0, 0);
});

test('B4c undo/redo is ordered across mixed actions', async ({ page }) => {
  await boot(page, { blank: true });
  const rows = page.locator('.layer-row');
  const before = await rows.count();

  await drawShape(page, 'Rectangle', 160, 100);
  const xAfterDraw = Number(await field(page, 'X').inputValue());
  const moveBy = await toDoc(page, 100);
  await tool(page, 'Move').click();
  await drag(page, [0, 0], [100, 0]);
  await page.waitForTimeout(250);

  // Undo the move, then the draw.
  await page.keyboard.press('Control+z');
  expect(Number(await field(page, 'X').inputValue())).toBeCloseTo(xAfterDraw, 0);
  await page.keyboard.press('Control+z');
  await expect(rows).toHaveCount(before);

  // Redo both, in order.
  await page.keyboard.press('Control+Shift+z');
  await expect(rows).toHaveCount(before + 1);
  await page.keyboard.press('Control+Shift+z');
  expect(Number(await field(page, 'X').inputValue())).toBeCloseTo(xAfterDraw + moveBy, 0);
});

test('B4d undo at the start of history is a no-op', async ({ page }) => {
  await boot(page);
  const rows = page.locator('.layer-row');
  const before = await rows.count();

  for (let i = 0; i < 5; i++) await page.keyboard.press('Control+z');
  await expect(rows).toHaveCount(before);
  await expect(page.locator('.app')).toBeVisible();
});
