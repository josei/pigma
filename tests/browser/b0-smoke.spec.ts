import { test, expect } from '@playwright/test';

test('B0 app boots and renders the editor shell', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await expect(page.locator('#root')).not.toBeEmpty();

  expect(errors, 'uncaught page errors on boot').toEqual([]);
});
