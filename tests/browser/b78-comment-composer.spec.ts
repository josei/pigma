import { test, expect, type Page } from '@playwright/test';
import { boot, tool } from './helpers';

const threads = (page: Page) => page.evaluate(() => (window.__pigmaStore!.getState().file.comments ?? []).length);
const placeAtCentre = async (page: Page) => {
  await tool(page, 'Comment').click();
  const box = (await page.locator('.canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
};

/** A comment is a draft until it is posted: placing it does not create a thread. */
test('B78a placing a comment opens a composer and creates nothing until it is posted', async ({ page }) => {
  await boot(page, { blank: true });
  await placeAtCentre(page);
  await expect(page.locator('[data-testid="comment-composer"]')).toBeVisible();
  await expect(page.locator('[data-testid="comment-draft"]')).toHaveCount(1);
  expect(await threads(page), 'a thread was created before any text was written').toBe(0);
  await page.locator('textarea[aria-label="New comment text"]').fill('Make this bolder');
  await page.locator('button[aria-label="Post comment"]').click();
  await expect(page.locator('[data-testid="comment-composer"]')).toHaveCount(0);
  expect(await threads(page)).toBe(1);
  await expect(page.locator('.app__left')).toContainText('Make this bolder');
});

test('B78b cancelling a comment leaves no thread and no draft pin', async ({ page }) => {
  await boot(page, { blank: true });
  await placeAtCentre(page);
  await page.locator('button[aria-label="Cancel comment"]').click();
  await expect(page.locator('[data-testid="comment-draft"]')).toHaveCount(0);
  expect(await threads(page)).toBe(0);
});

test('B78c Post stays disabled while the comment is empty', async ({ page }) => {
  await boot(page, { blank: true });
  await placeAtCentre(page);
  await expect(page.locator('button[aria-label="Post comment"]')).toBeDisabled();
  await page.locator('textarea[aria-label="New comment text"]').fill('   ');
  await expect(page.locator('button[aria-label="Post comment"]')).toBeDisabled();
});

/** A draft comment belongs to its page: switching pages drops it, so it cannot land on another page. */
test('B78d a draft comment does not follow the user to another page', async ({ page }) => {
  await boot(page, { blank: true });
  await page.locator('button[aria-label="Add page"]').click();
  await page.locator('.page-row').nth(0).click();
  await placeAtCentre(page);
  await expect(page.locator('[data-testid="comment-draft"]')).toHaveCount(1);
  await page.locator('.rail__button[aria-label="Layers"]').click();
  await page.locator('.page-row').nth(1).click();
  await expect(page.locator('[data-testid="comment-draft"]'), 'the draft pin followed the user to another page').toHaveCount(0);
  expect(await threads(page)).toBe(0);
});
