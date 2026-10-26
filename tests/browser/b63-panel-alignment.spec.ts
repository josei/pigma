import { test, expect } from '@playwright/test';
import { boot, drawShape, tool } from './helpers';

/**
 * Segmented rows in the Design panel share one label column, and every segment
 * stays inside the panel, at the default width.
 */
test('B63a the auto layout segmented rows start at one x and fit the panel', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Frame', 200, 160);
  await tool(page, 'Move').click();
  await page.locator('[aria-label="Row"], [aria-label="Horizontal"]').first().waitFor();
  const panel = (await page.locator('aside').last().boundingBox())!;
  const groups = page.locator('aside').last().locator('.prop-row:has(> .segmented) > .segmented');
  const count = await groups.count();
  expect(count).toBeGreaterThanOrEqual(3);
  const starts = new Set<number>();
  for (let i = 0; i < count; i++) {
    const box = (await groups.nth(i).boundingBox())!;
    starts.add(Math.round(box.x));
    expect(box.x + box.width, `segmented row ${i} overflows the panel`).toBeLessThanOrEqual(panel.x + panel.width);
  }
  expect(starts.size, `segmented controls start at ${[...starts]}`).toBe(1);
});
