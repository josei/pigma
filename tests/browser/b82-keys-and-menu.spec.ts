import { test, expect } from '@playwright/test';
import { boot, openMenu } from './helpers';

/** The theme entry shows no key, because Shift+D is Dev Mode. */
test('B82a the dark theme menu item shows no shortcut, since Shift+D is Dev Mode', async ({ page }) => {
  await boot(page, { blank: true });
  await openMenu(page);
  const item = page.locator('.menu__item', { hasText: 'Toggle dark theme' });
  await expect(item).toBeVisible();
  await expect(item, 'the stale ⇧D label is still shown').not.toContainText('⇧D');
});

/** F6 moves the keyboard focus to the tools toolbar. */
test('B82b F6 moves focus to the tools toolbar', async ({ page }) => {
  await boot(page, { blank: true });
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('F6');
  const inToolbar = await page.evaluate(() => !!document.activeElement?.closest('.toolbar'));
  expect(inToolbar, 'F6 did not focus a control in the toolbar').toBe(true);
});
