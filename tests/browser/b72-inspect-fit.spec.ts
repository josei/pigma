import { test, expect } from '@playwright/test';

/** Inspect's labels and buttons fit the 240px panel: none is cut off. */
test('B72a the Inspect tab shows every label and button in full', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.app');
  await page.locator('.layer-row', { hasText: 'Home / Hero' }).first().click();
  await page.getByRole('tab', { name: 'Inspect' }).or(page.locator('text=Inspect').first()).click();
  const clipped = await page.evaluate(() => {
    const aside = document.querySelector('aside:last-of-type') ?? document.querySelector('.app__right');
    const items = [...(aside?.querySelectorAll('button, .section__header > span:first-child') ?? [])] as HTMLElement[];
    return items
      .filter((el) => el.offsetParent !== null && el.scrollWidth > el.clientWidth + 1)
      .map((el) => el.textContent?.trim() ?? '');
  });
  expect(clipped, `clipped in Inspect: ${JSON.stringify(clipped)}`).toEqual([]);
  await expect(page.getByRole('button', { name: 'Mark ready for development' })).toBeVisible();
  await expect(page.locator('.section__header span', { hasText: /^Code$/ })).toBeVisible();
});
