/**
 * The keyboard shortcut reference (Figma's shortcut panel): Ctrl/Cmd+Shift+/ opens it, Escape closes it,
 * and the Help group of the main menu opens it too. The list is checked against the menu in
 * shortcutList.test.ts.
 */
import { test, expect } from '@playwright/test';
import { boot, openMenu } from './helpers';

test('B111a Ctrl+Shift+/ opens the shortcut reference, which lists the tools and the view shortcuts, and Escape closes it', async ({ page }) => {
  await boot(page, { blank: true });
  await page.keyboard.press('Control+Shift+/');
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Rectangle');
  await expect(dialog).toContainText('Zoom to fit');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('B111b the Help group of the main menu opens the same reference', async ({ page }) => {
  await boot(page, { blank: true });
  await openMenu(page);
  await page.locator('.menu__item', { hasText: 'Keyboard shortcuts' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
});
