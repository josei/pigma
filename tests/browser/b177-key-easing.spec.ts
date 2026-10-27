/**
 * Easing on an opacity key: the key at the key time eases the segment that leaves it, so a time a quarter of the way along shows
 * the smoothstep of that quarter, not the straight line. The model is unit-tested (keyframes.test.ts); this drives the live panel.
 */
import { test, expect } from '@playwright/test';
import { boot, drawShape, nextPaint } from './helpers';

test('B177a an eased opacity key moves along a smoothstep, and the section marks it', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 100, 60, 0, 0);
  await nextPaint(page);

  const section = page.locator('.section', { has: page.locator('.section__header', { hasText: 'Animation' }) });
  const time = section.getByLabel('Key time (ms)', { exact: true });
  // Opacity 100 percent at 500 ms, then 40 percent at 900 ms.
  await time.fill('500');
  await time.press('Enter');
  await section.getByRole('button', { name: 'Key opacity' }).click();
  const opacity = page.locator('input[aria-label="Opacity"]').first();
  await opacity.fill('40');
  await opacity.press('Enter');
  await time.fill('900');
  await time.press('Enter');
  await section.getByRole('button', { name: 'Key opacity' }).click();

  // Ease the key at 500 ms.
  await time.fill('500');
  await time.press('Enter');
  await section.getByRole('button', { name: 'Toggle opacity easing' }).click();
  await nextPaint(page);
  await expect(section.locator('p')).toHaveText('Opacity keys: 500 ms (ease), 900 ms. Rotation keys: none.');

  // A quarter of the way from 500 to 900 ms: smoothstep(0.25) = 0.15625 of the way from 100 to 40 percent, so 90.625 percent.
  await time.fill('600');
  await time.press('Enter');
  await section.getByRole('button', { name: 'Apply keys at time' }).click();
  await nextPaint(page);

  const stored = await page.evaluate(() => (window.__pigmaStore!.getState().file.document.children[0]!.children[0] as unknown as { opacity: number }).opacity);
  expect(stored).toBeCloseTo(0.90625, 6);
});
