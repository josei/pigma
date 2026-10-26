import { test, expect } from '@playwright/test';
import { boot } from './helpers';

/** A built-in plugin's full name, including its "built-in" tag, is visible: names wrap, they are not cut. */
test('B77a every plugin row shows its full name and its built-in tag', async ({ page }) => {
  await boot(page, { blank: true });
  await page.locator('.rail__button[aria-label="Plugins"]').click();
  const rows = page.locator('.app__left .plugin-row .layer-row__name');
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const name = rows.nth(i);
    const clipped = await name.evaluate((el) => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1);
    expect(clipped, `plugin name clipped: ${await name.textContent()}`).toBe(false);
  }
  await expect(page.locator('.app__left .plugin-row', { hasText: 'built-in' }).first()).toContainText('built-in');
});
