/**
 * Quick actions (Ctrl+/) also search the document: a typed layer name finds the layer and Enter selects it, and a typed
 * page name finds the page and Enter opens it. The entries are unit-tested (matchQuickActions.test.ts); this drives the
 * live dialog.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape } from './helpers';

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Quick actions' });
const search = (page: Page) => page.getByRole('textbox', { name: 'Search quick actions' });
// The palette's own list: the page's selects also hold <option> elements, which carry the same role.
const matches = (page: Page) => page.getByRole('listbox', { name: 'Matching commands' }).getByRole('option');

test('B141a a typed layer name finds the layer, and Enter selects it alone', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 120, 90, -160, 0);
  await drawShape(page, 'Rectangle', 120, 90, 160, 0);
  await page.keyboard.press('Control+/');
  await expect(dialog(page)).toBeVisible();
  await search(page).fill('rectangle 1');
  await expect(matches(page)).toHaveCount(1);
  await expect(matches(page)).toContainText('Layer: Rectangle 1');
  await page.keyboard.press('Enter');
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator('.layer-row--selected')).toHaveCount(1);
  await expect(page.locator('.layer-row--selected')).toContainText('Rectangle 1');
});

test('B141b a typed page name finds the page, and Enter opens it', async ({ page }) => {
  await boot(page, { blank: true });
  await page.evaluate(() => window.__pigmaStore!.getState().addPage());
  const firstPage = await page.evaluate(() => window.__pigmaStore!.getState().file.document.children[0]!.id);
  const secondPage = await page.evaluate(() => window.__pigmaStore!.getState().file.document.children[1]!.id);
  await page.evaluate((id) => window.__pigmaStore!.getState().setPage(id), firstPage);
  await page.keyboard.press('Control+/');
  await search(page).fill('page 2');
  await expect(matches(page)).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(dialog(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.__pigmaStore!.getState().pageId)).toBe(secondPage);
});
