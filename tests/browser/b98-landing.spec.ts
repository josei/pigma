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

  // The honest limits are on the page, not discovered later as errors.
  await expect(page.locator('#online')).toContainText('Shared rooms');
  await expect(page.locator('#online')).toContainText('AI agent');

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
