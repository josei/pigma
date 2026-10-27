/**
 * Playback: Play moves the key time on frame by frame and turns the animation preview on; Pause stops it. The stored layer does not
 * change while it plays. The wrap and the step are unit-tested (advanceTime in keyframes.test.ts); this drives the live panel.
 */
import { test, expect } from '@playwright/test';
import { boot, drawShape, nextPaint } from './helpers';

test('B181a Play moves the key time on and shows the preview; Pause stops it, and the stored layer is unchanged', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 100, 60, 0, 0);
  await nextPaint(page);

  const section = page.locator('.section', { has: page.locator('.section__header', { hasText: 'Animation' }) });
  const time = section.getByLabel('Key time (ms)', { exact: true });
  // Opacity 100 percent at 0 ms, then 40 percent at 1000 ms.
  await time.fill('0');
  await time.press('Enter');
  await section.getByRole('button', { name: 'Key opacity' }).click();
  const opacity = page.locator('input[aria-label="Opacity"]').first();
  await opacity.fill('40');
  await opacity.press('Enter');
  await time.fill('1000');
  await time.press('Enter');
  await section.getByRole('button', { name: 'Key opacity' }).click();
  await time.fill('0');
  await time.press('Enter');
  await nextPaint(page);

  const keyTime = () => page.evaluate(() => window.__pigmaStore!.getState().keyframeTime);
  await section.getByRole('button', { name: 'Play' }).click();
  await expect.poll(keyTime, { timeout: 5000 }).toBeGreaterThan(0);
  await expect(section.getByRole('button', { name: 'Stop preview' })).toHaveCount(1);

  await section.getByRole('button', { name: 'Pause' }).click();
  const paused = await keyTime();
  expect(paused).toBeGreaterThan(0);
  expect(paused).toBeLessThan(2000);
  await nextPaint(page);
  expect(await keyTime()).toBe(paused);

  const stored = await page.evaluate(() => (window.__pigmaStore!.getState().file.document.children[0]!.children[0] as unknown as { opacity: number }).opacity);
  expect(stored).toBeCloseTo(0.4, 6);
});
