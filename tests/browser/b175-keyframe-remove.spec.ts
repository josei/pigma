/**
 * Remove a key from the Animation section: the key at the key time goes from the selected layer's track, and the section lists the
 * key times that remain. The model is unit-tested (removeKeyframeOp in keyframes.test.ts); this drives the live panel.
 */
import { test, expect } from '@playwright/test';
import { boot, drawShape, nextPaint } from './helpers';

test('B175a Remove opacity key removes the key at the key time, and the section lists the times that remain', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 100, 60, 0, 0);
  await nextPaint(page);

  const section = page.locator('.section', { has: page.locator('.section__header', { hasText: 'Animation' }) });
  const time = section.getByLabel('Key time (ms)', { exact: true });
  await time.fill('500');
  await time.press('Enter');
  await section.getByRole('button', { name: 'Key opacity' }).click();
  await time.fill('900');
  await time.press('Enter');
  await section.getByRole('button', { name: 'Key opacity' }).click();
  await nextPaint(page);
  await expect(section.locator('p')).toHaveText('Opacity keys: 500 ms, 900 ms. Rotation keys: none.');

  await time.fill('500');
  await time.press('Enter');
  await section.getByRole('button', { name: 'Remove opacity key' }).click();
  await nextPaint(page);
  await expect(section.locator('p')).toHaveText('Opacity keys: 900 ms. Rotation keys: none.');
});
