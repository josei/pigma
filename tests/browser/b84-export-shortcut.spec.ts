import { test, expect } from '@playwright/test';
import { boot, drawShape, openMenu, tool } from './helpers';

/** Cmd/Ctrl+Shift+E is Figma's Export: it opens the export options for the selection. */
test('B84a Ctrl+Shift+E opens the PNG export options for the selection', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 100, 80, 0, 0);
  await tool(page, 'Move').click();
  await page.keyboard.press('Control+Shift+e');
  const dialog = page.getByRole('dialog', { name: 'PNG export options' });
  await expect(dialog).toBeVisible();
  await expect(page.locator('[aria-label="PNG scope"]')).toBeVisible();
});

test('B84b Ctrl+Shift+E with nothing selected says what to do, and opens nothing', async ({ page }) => {
  await boot(page, { blank: true });
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+Shift+e');
  await expect(page.getByText('Select something to export')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'PNG export options' })).toHaveCount(0);
});

test('B84c the menu shows the Export shortcut beside the item it opens', async ({ page }) => {
  await boot(page, { blank: true });
  await openMenu(page);
  await expect(page.locator('.menu__item', { hasText: 'Export selection as PNG' })).toContainText('⇧⌘E');
});
