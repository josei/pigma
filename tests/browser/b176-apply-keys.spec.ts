/**
 * Apply keys at time: the selected layer takes its keys' values at the key time, so a time between two keys shows the straight
 * line between them. The model is unit-tested (applyKeysOp in keyframes.test.ts); this drives the live panel and reads the layer's
 * opacity from the store and the Opacity field.
 */
import { test, expect } from '@playwright/test';
import { boot, drawShape, nextPaint } from './helpers';

test('B176a Apply keys at time sets the layer to the value its keys give between them', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 100, 60, 0, 0);
  await nextPaint(page);

  const section = page.locator('.section', { has: page.locator('.section__header', { hasText: 'Animation' }) });
  const time = section.getByLabel('Key time (ms)', { exact: true });
  // Opacity 100 percent at 500 ms.
  await time.fill('500');
  await time.press('Enter');
  await section.getByRole('button', { name: 'Key opacity' }).click();
  // Opacity 40 percent at 900 ms.
  const opacity = page.locator('input[aria-label="Opacity"]').first();
  await opacity.fill('40');
  await opacity.press('Enter');
  await time.fill('900');
  await time.press('Enter');
  await section.getByRole('button', { name: 'Key opacity' }).click();
  await nextPaint(page);

  // Halfway between 500 and 900 ms is halfway between 100 and 40 percent: 70 percent.
  await time.fill('700');
  await time.press('Enter');
  await section.getByRole('button', { name: 'Apply keys at time' }).click();
  await nextPaint(page);

  const stored = await page.evaluate(() => (window.__pigmaStore!.getState().file.document.children[0]!.children[0] as unknown as { opacity: number }).opacity);
  expect(stored).toBeCloseTo(0.7, 6);
  await expect(opacity).toHaveValue('70');
});
