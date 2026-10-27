/**
 * Easing on a rotation key: the key at the key time eases the segment that leaves it, so a time a quarter of the way along turns the
 * layer the smoothstep of that quarter, not the straight line. The model is unit-tested (keyframes.test.ts); this drives the live panel.
 */
import { test, expect } from '@playwright/test';
import { boot, drawShape, nextPaint } from './helpers';

test('B178a an eased rotation key turns the layer along a smoothstep', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 100, 60, 0, 0);
  await nextPaint(page);

  const section = page.locator('.section', { has: page.locator('.section__header', { hasText: 'Animation' }) });
  const time = section.getByLabel('Key time (ms)', { exact: true });
  // Unturned at 0 ms, then turned 90 degrees at 1000 ms.
  await time.fill('0');
  await time.press('Enter');
  await section.getByRole('button', { name: 'Key rotation' }).click();
  const rotation = page.getByLabel('Rotation', { exact: true }).first();
  await rotation.fill('90');
  await rotation.press('Enter');
  await time.fill('1000');
  await time.press('Enter');
  await section.getByRole('button', { name: 'Key rotation' }).click();

  // Ease the key at 0 ms.
  await time.fill('0');
  await time.press('Enter');
  await section.getByRole('button', { name: 'Toggle rotation easing' }).click();
  await nextPaint(page);
  await expect(section.locator('p')).toHaveText('Opacity keys: none. Rotation keys: 0 ms (ease), 1000 ms.');

  // A quarter of the way to 1000 ms: smoothstep(0.25) = 0.15625 of 90 degrees, so about 14.06 degrees.
  await time.fill('250');
  await time.press('Enter');
  await section.getByRole('button', { name: 'Apply keys at time' }).click();
  await nextPaint(page);

  const degrees = await page.evaluate(() => {
    const layer = window.__pigmaStore!.getState().file.document.children[0]!.children[0] as unknown as { transform: { a: number; b: number } };
    return (Math.atan2(layer.transform.b, layer.transform.a) * 180) / Math.PI;
  });
  expect(degrees).toBeCloseTo(90 * 0.15625, 3);
});
