import { test, expect, type Page } from '@playwright/test';

/** A phone-sized viewport with touch, matching the mobile layout target. */
const PHONE = { width: 390, height: 844 };

async function openMobile(page: Page) {
  await page.setViewportSize(PHONE);
  await page.goto('/?blank=1');
  await page.waitForSelector('.app');
  await page.waitForTimeout(700);
}

const panelWidth = (page: Page) =>
  page.evaluate(() => Math.round(document.querySelector('.app__left')!.getBoundingClientRect().width));

test('B29a the mobile shell does not scroll horizontally', async ({ page }) => {
  await openMobile(page);
  const metrics = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
    bodyScrollW: document.body.scrollWidth,
  }));
  expect(metrics.scrollW, `document scrollWidth ${metrics.scrollW} vs viewport ${metrics.innerW}`).toBe(
    metrics.innerW,
  );
  expect(metrics.bodyScrollW).toBe(metrics.innerW);
});

test('B29b the canvas keeps real width at phone size', async ({ page }) => {
  await openMobile(page);
  const width = await page.evaluate(() =>
    Math.round(document.querySelector('.canvas')!.getBoundingClientRect().width),
  );
  expect(width, 'the canvas collapsed at phone width').toBeGreaterThan(100);
});

test('B29c the panel drawer closes and reopens', async ({ page }) => {
  await openMobile(page);

  const open = await panelWidth(page);
  expect(open, 'the drawer was not open at phone size').toBeGreaterThan(0);

  const close = page.locator('[aria-label="Close panel"]').first();
  await expect(close).toHaveCount(1);
  await close.click();
  await page.waitForTimeout(400);
  expect(await panelWidth(page), 'the drawer did not close').toBe(0);

  // Reopen from the rail.
  await page.locator('.rail__button[aria-label="Layers"]').click();
  await page.waitForTimeout(400);
  expect(await panelWidth(page), 'the drawer did not reopen').toBeGreaterThan(0);
});

test('B29d interactive controls meet the 44px touch target', async ({ page }) => {
  await openMobile(page);

  const small = await page.evaluate(() => {
    const controls = [...document.querySelectorAll('button')].filter((b) => {
      const r = b.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    return controls
      .map((b) => {
        const r = b.getBoundingClientRect();
        return {
          aria: b.getAttribute('aria-label') ?? (b.textContent ?? '').trim().slice(0, 20),
          w: Math.round(r.width),
          h: Math.round(r.height),
        };
      })
      .filter((c) => c.w < 44 || c.h < 44);
  });

  expect(
    small,
    `${small.length} control(s) below the 44px touch target: ${JSON.stringify(small.slice(0, 8))}`,
  ).toEqual([]);
});
