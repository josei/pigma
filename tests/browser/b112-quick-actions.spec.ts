/**
 * Quick actions (Cmd/Ctrl+/, Figma's Quick actions): a search over the menu's commands. Typing filters them,
 * the arrow keys move the highlight, Enter runs the highlighted command, and Escape closes it. The matcher is
 * unit-tested (matchQuickActions.test.ts); this drives the live dialog.
 */
import { test, expect } from '@playwright/test';
import { boot } from './helpers';

const dialog = (page: import('@playwright/test').Page) => page.getByRole('dialog', { name: 'Quick actions' });

test('B112a Ctrl+/ opens quick actions, a typed word lists matching commands, and Enter runs the highlighted one', async ({ page }) => {
  await boot(page, { blank: true });
  await page.keyboard.press('Control+/');
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page)).toContainText('Type a word to find a command.');

  await page.getByRole('textbox', { name: 'Search quick actions' }).fill('keyboard');
  const matches = page.getByRole('option');
  await expect(matches).toHaveCount(1);
  await page.keyboard.press('Enter');
  // The command it ran is the menu's own "Keyboard shortcuts…", which opens the reference.
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  await expect(dialog(page)).toHaveCount(0);
});

test('B112c Ctrl+K opens the same quick actions dialog as Ctrl+/, and Escape closes it', async ({ page }) => {
  await boot(page, { blank: true });
  await page.keyboard.press('Control+K');
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page)).toContainText('Type a word to find a command.');
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
});

test('B112b the arrow keys move the highlight, Escape closes, and a word that matches nothing says so', async ({ page }) => {
  await boot(page, { blank: true });
  await page.keyboard.press('Control+/');
  const search = page.getByRole('textbox', { name: 'Search quick actions' });

  await search.fill('export');
  const options = page.getByRole('option');
  expect(await options.count()).toBeGreaterThan(1);
  await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(options.nth(0)).toHaveAttribute('aria-selected', 'false');

  await search.fill('zzqx');
  await expect(dialog(page)).toContainText('No command matches');
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
});
