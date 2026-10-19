import { test, expect } from '@playwright/test';

/**
 * The landing page at the site root: a call to action into the editor, and the
 * explanation of what the online copy does not do. The editor itself is under /app/.
 */
test('B98a the landing page offers the editor, and says what the online copy cannot do', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('browser');

  const cta = page.locator('a.btn-primary');
  await expect(cta).toHaveText(/Open the editor/);
  await expect(cta).toHaveAttribute('href', 'app/');

  // The honest limit is on the page where the feature is described, not discovered later as an error.
  await expect(page.locator('#ai')).toContainText('Model Context Protocol');
  await expect(page.locator('#ai')).toContainText('online copy has no server');

  // The domain we do not own is never named.
  const text = (await page.locator('body').textContent()) ?? '';
  expect(text).not.toMatch(/pigma\.design/i);
});

test('B98b the call to action opens the editor', async ({ page }) => {
  await page.goto('/');
  await page.locator('a.btn-primary').click();
  await page.waitForURL(/\/app\/$/);
  await expect(page.locator('.app')).toBeVisible();
});
