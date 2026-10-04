import { test, expect, type Page } from '@playwright/test';
import { boot, tool } from './helpers';

/**
 * The ready-for-development status (F3).
 *
 * A designer marks a top-level frame in the Inspect panel; the status shows as a
 * badge in the layers list and must survive a reload, because a handoff status
 * that resets on refresh is worse than none.
 */
const badge = (page: Page) => page.locator('[data-testid="layer-dev-status"]');

async function openInspect(page: Page): Promise<void> {
  const tab = page.locator('.tab', { hasText: 'Inspect' });
  await expect(tab).toHaveCount(1);
  await tab.click();
  await page.waitForTimeout(350);
}

async function drawFrame(page: Page): Promise<void> {
  await boot(page, { blank: true });
  await tool(page, 'Frame').click();
  const box = (await page.locator('.canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx - 120, cy - 90);
  await page.mouse.down();
  await page.mouse.move(cx + 120, cy + 90, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(450);
}

test('B48a marking a frame ready shows a badge in the layers list', async ({ page }) => {
  await drawFrame(page);
  await openInspect(page);

  // No status to begin with.
  await expect(badge(page), 'a badge appeared without a status being set').toHaveCount(0);
  await expect(page.locator('[aria-label="Clear development status"]')).toHaveCount(0);

  await page.locator('[aria-label="Mark ready for development"]').click();
  await page.waitForTimeout(350);

  await expect(badge(page)).toHaveCount(1);
  await expect(badge(page)).toHaveAttribute('data-status', 'READY_FOR_DEVELOPMENT');
  await expect(badge(page)).toContainText('Ready');
  // Setting a status offers the way back out.
  await expect(page.locator('[aria-label="Clear development status"]')).toHaveCount(1);
});

test('B48b the status badge survives a reload', async ({ page }) => {
  await drawFrame(page);
  await openInspect(page);
  await page.locator('[aria-label="Mark ready for development"]').click();
  await page.waitForTimeout(400);
  await expect(badge(page)).toHaveCount(1);

  // Reload WITHOUT ?blank=1: that flag boots a fresh empty document each time,
  // so a `page.reload()` would discard the drawing and prove nothing (this is
  // the same trap b7 documents).
  await page.goto('/');
  await page.waitForSelector('.app');
  await page.waitForTimeout(900);

  await expect(badge(page), 'the ready-for-development badge did not survive the reload').toHaveCount(1);
  await expect(badge(page)).toHaveAttribute('data-status', 'READY_FOR_DEVELOPMENT');
});

test('B48c completed and cleared statuses are reflected and survive a reload', async ({ page }) => {
  await drawFrame(page);
  await openInspect(page);

  await page.locator('[aria-label="Mark completed"]').click();
  await page.waitForTimeout(350);
  await expect(badge(page)).toHaveAttribute('data-status', 'COMPLETED');
  await expect(badge(page)).toContainText('Done');

  // A different status replaces the first rather than stacking badges.
  await page.locator('[aria-label="Mark ready for development"]').click();
  await page.waitForTimeout(350);
  await expect(badge(page), 'the previous status badge was not replaced').toHaveCount(1);
  await expect(badge(page)).toHaveAttribute('data-status', 'READY_FOR_DEVELOPMENT');

  await page.locator('[aria-label="Clear development status"]').click();
  await page.waitForTimeout(350);
  await expect(badge(page), 'clearing the status left the badge behind').toHaveCount(0);

  await page.goto('/');
  await page.waitForSelector('.app');
  await page.waitForTimeout(900);
  // The frame is still here (so this is about the status, not a lost document)...
  await expect(page.locator('.layer-row').first()).toBeVisible();
  // ...and the cleared status stayed cleared.
  await expect(badge(page), 'the cleared status came back after a reload').toHaveCount(0);
});
