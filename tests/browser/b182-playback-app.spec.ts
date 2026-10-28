/**
 * Playback runs at app level: with the Animation section closed (the selection cleared), playback keeps moving the key time on. The
 * loop used to live in the section and stopped with it. The panel is only the control; this drives the store and the section.
 */
import { test, expect } from '@playwright/test';
import { boot, drawShape, nextPaint } from './helpers';

test('B182a playback keeps running when the Animation section closes', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 100, 60, 0, 0);
  await nextPaint(page);

  const section = page.locator('.section', { has: page.locator('.section__header', { hasText: 'Animation' }) });
  await section.getByRole('button', { name: 'Play' }).click();
  const keyTime = () => page.evaluate(() => window.__pigmaStore!.getState().keyframeTime);
  await expect.poll(keyTime, { timeout: 5000 }).toBeGreaterThan(0);

  // Close the section by clearing the selection, then check that the time still moves on.
  await page.evaluate(() => window.__pigmaStore!.getState().clearSelection());
  await nextPaint(page);
  await expect(page.locator('.section__header', { hasText: 'Animation' })).toHaveCount(0);
  const before = await keyTime();
  await expect.poll(keyTime, { timeout: 5000 }).not.toBe(before);
  expect(await page.evaluate(() => window.__pigmaStore!.getState().playing)).toBe(true);
});
