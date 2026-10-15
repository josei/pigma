import { test, expect } from '@playwright/test';

/** Every room is encrypted: there is no plaintext option, and Join needs a key. */
test('B66a the Rooms panel offers no plaintext join', async ({ page }) => {
  await page.goto('/?blank=1');
  await page.waitForSelector('.app');
  await page.locator('.rail__button[aria-label="Rooms"]').click();
  await expect(page.locator('input[aria-label="Room nickname"]')).toBeVisible();
  await expect(page.locator('input[aria-label="Join in plaintext"]')).toHaveCount(0);
  await expect(page.getByText(/plaintext/i)).toHaveCount(0);
});

test('B66b Join is disabled without a key, and says why', async ({ page }) => {
  await page.goto('/?blank=1');
  await page.waitForSelector('.app');
  await page.locator('.rail__button[aria-label="Rooms"]').click();
  await page.locator('input[aria-label="Room nickname"]').fill('Ada');
  await page.locator('input[aria-label="Room id"]').fill('studio');
  await expect(page.locator('[aria-label="Join room"]')).toBeDisabled();
  await expect(page.getByText(/Rooms are encrypted/i)).toBeVisible();
});

test('B66c Share creates the key, and Join then becomes available', async ({ page }) => {
  await page.goto('/?blank=1');
  await page.waitForSelector('.app');
  await page.locator('.rail__button[aria-label="Rooms"]').click();
  await page.locator('input[aria-label="Room nickname"]').fill('Ada');
  await page.locator('input[aria-label="Room id"]').fill('studio');
  await page.locator('[aria-label="Create share link"]').click();
  await expect(page.locator('input[aria-label="Room key"]')).not.toHaveValue('');
  await expect(page.locator('[aria-label="Join room"]')).toBeEnabled();
});
