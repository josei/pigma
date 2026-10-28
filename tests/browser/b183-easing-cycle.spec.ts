/**
 * The easing control steps one key through four curves: linear, ease-in-out, ease-in, ease-out, then back to linear. The
 * readout names each one, so a key's curve is visible without opening the file. The model is unit-tested (keyframes.test.ts);
 * this drives the live panel.
 */
import { test, expect } from '@playwright/test';
import { boot, drawShape, nextPaint } from './helpers';

test('B183a the easing control steps a key through linear, ease-in-out, ease-in, ease-out and back', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 100, 60, 0, 0);
  await nextPaint(page);

  const section = page.locator('.section', { has: page.locator('.section__header', { hasText: 'Animation' }) });
  const time = section.getByLabel('Key time (ms)', { exact: true });
  // Opacity keys at 500 ms and 900 ms, both linear to start with.
  await time.fill('500');
  await time.press('Enter');
  await section.getByRole('button', { name: 'Key opacity' }).click();
  await time.fill('900');
  await time.press('Enter');
  await section.getByRole('button', { name: 'Key opacity' }).click();

  const toggle = section.getByRole('button', { name: 'Toggle opacity easing' });
  const readout = section.locator('p');
  await time.fill('500');
  await time.press('Enter');

  const labels = ['(ease)', '(ease in)', '(ease out)', ''];
  for (const label of labels) {
    await toggle.click();
    await nextPaint(page);
    await expect(readout).toHaveText(`Opacity keys: 500 ms${label ? ` ${label}` : ''}, 900 ms. Rotation keys: none.`);
  }
});
