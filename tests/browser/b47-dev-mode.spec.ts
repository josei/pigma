import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape } from './helpers';

/**
 * Dev Mode as a workspace (F3).
 *
 * Entering it must switch the right panel to Inspect and take the design-only
 * surfaces away, and it must be reversible - a one-way switch would strand a
 * developer in handoff view.
 */
const toggle = (page: Page) => page.locator('[aria-label="Toggle dev mode"]');

async function rightTabs(page: Page) {
  return page.locator('[data-testid="right-tabs"]');
}

test('B47a dev mode switches the right panel to Inspect and hides the design surfaces', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 160, 100);

  // Design mode first: the design tabs are present and dev mode is off.
  await expect(await rightTabs(page)).toHaveAttribute('data-dev-mode', 'false');
  await expect(page.locator('.tab', { hasText: 'Design' })).toHaveCount(1);
  await expect(page.locator('.tab', { hasText: 'Prototype' })).toHaveCount(1);

  await toggle(page).click();
  await page.waitForTimeout(400);

  // Dev mode: Inspect is the panel, the design-only tabs are gone.
  await expect(await rightTabs(page)).toHaveAttribute('data-dev-mode', 'true');
  await expect(page.locator('.tab', { hasText: 'Design' }), 'the Design tab is still offered').toHaveCount(0);
  await expect(page.locator('.tab', { hasText: 'Prototype' }), 'the Prototype tab is still offered').toHaveCount(0);
  await expect(page.locator('.tab', { hasText: 'Inspect' })).toHaveCount(1);

  // The Inspect content is actually showing, not merely selected.
  await expect(page.locator('[aria-label="Show CSS"]')).toBeVisible();
  await expect(page.locator('pre[aria-label="Generated code"]')).toBeVisible();
});

test('B47b the toggle reflects its state and is reversible', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 160, 100);

  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
  await toggle(page).click();
  await page.waitForTimeout(350);
  await expect(toggle(page), 'the toggle does not report itself as active').toHaveAttribute('aria-pressed', 'true');

  await toggle(page).click();
  await page.waitForTimeout(350);

  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(await rightTabs(page)).toHaveAttribute('data-dev-mode', 'false');
  await expect(page.locator('.tab', { hasText: 'Design' }), 'Design did not come back').toHaveCount(1);
  await expect(page.locator('.tab', { hasText: 'Prototype' }), 'Prototype did not come back').toHaveCount(1);

  // And the design surface is usable again, not just present.
  await page.locator('.tab', { hasText: 'Design' }).click();
  await page.waitForTimeout(300);
  await expect(page.locator('input[aria-label="W"]')).toBeVisible();
});
