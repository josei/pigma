/**
 * Quick actions (Ctrl+/) finds a layer on another page: the entry names the page, and Enter opens that page and selects
 * the layer on it. The entries are unit-tested (matchQuickActions.test.ts); this drives the live dialog.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape } from './helpers';

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Quick actions' });
const search = (page: Page) => page.getByRole('textbox', { name: 'Search quick actions' });
// The palette's own list: the page's selects also hold <option> elements, which carry the same role.
const matches = (page: Page) => page.getByRole('listbox', { name: 'Matching commands' }).getByRole('option');

test('B142a a layer on another page is found by name, labelled with its page', async ({ page }) => {
  await boot(page, { blank: true });
  const firstPage = await page.evaluate(() => window.__pigmaStore!.getState().file.document.children[0]!.id);
  await page.evaluate(() => window.__pigmaStore!.getState().addPage());
  const secondPage = await page.evaluate(() => window.__pigmaStore!.getState().file.document.children[1]!.id);
  await page.evaluate((id) => window.__pigmaStore!.getState().setPage(id), secondPage);
  await drawShape(page, 'Frame', 160, 120, 0, 0);
  await page.evaluate((id) => window.__pigmaStore!.getState().setPage(id), firstPage);
  await page.keyboard.press('Control+/');
  await search(page).fill('frame 1');
  await expect(matches(page)).toHaveCount(1);
  await expect(matches(page)).toContainText('Layer: Frame 1 (Page 2)');
});

test('B142b Enter on a layer from another page opens that page and selects the layer there', async ({ page }) => {
  await boot(page, { blank: true });
  const firstPage = await page.evaluate(() => window.__pigmaStore!.getState().file.document.children[0]!.id);
  await page.evaluate(() => window.__pigmaStore!.getState().addPage());
  const secondPage = await page.evaluate(() => window.__pigmaStore!.getState().file.document.children[1]!.id);
  await page.evaluate((id) => window.__pigmaStore!.getState().setPage(id), secondPage);
  await drawShape(page, 'Frame', 160, 120, 0, 0);
  await page.evaluate((id) => window.__pigmaStore!.getState().setPage(id), firstPage);
  await page.keyboard.press('Control+/');
  await search(page).fill('frame 1');
  await page.keyboard.press('Enter');
  await expect(dialog(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.__pigmaStore!.getState().pageId)).toBe(secondPage);
  await expect(page.locator('.layer-row--selected')).toHaveCount(1);
  await expect(page.locator('.layer-row--selected')).toContainText('Frame 1');
});
