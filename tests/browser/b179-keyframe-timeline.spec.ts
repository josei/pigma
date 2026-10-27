/**
 * Keyframe timeline: a click on the strip sets the key time to the point clicked (10 ms steps across 0 to 2000 ms), and the keys of
 * the selected layer show as diamonds at their times. The mapping is unit-tested (timeAtFraction in keyframes.test.ts); this drives
 * the live panel.
 */
import { test, expect } from '@playwright/test';
import { boot, drawShape, nextPaint } from './helpers';

test('B179a a click on the timeline sets the key time, and a key shows as a diamond at its time', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 100, 60, 0, 0);
  await nextPaint(page);

  const section = page.locator('.section', { has: page.locator('.section__header', { hasText: 'Animation' }) });
  const timeline = section.getByLabel('Keyframe timeline', { exact: true });
  const time = section.getByLabel('Key time (ms)', { exact: true });
  const box = (await timeline.boundingBox())!;

  // Halfway along the strip: 1000 ms of the 2000 ms span.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await nextPaint(page);
  await expect(time).toHaveValue('1000');

  await section.getByRole('button', { name: 'Key opacity' }).click();
  await nextPaint(page);
  await expect(timeline).toHaveAttribute('data-key-count', '1');
  await expect(timeline.locator('span[data-property="opacity"]')).toHaveAttribute('data-time', '1000');

  // A quarter of the way along: 500 ms. The strip is about 215 px, so one pixel is about 9 ms and the click has to land on a whole
  // pixel: rounding up gives 502 ms, which the timeline rounds to 500.
  const moved = (await timeline.boundingBox())!;
  await page.mouse.click(moved.x + Math.ceil(moved.width / 4), moved.y + moved.height / 2);
  await nextPaint(page);
  await expect(time).toHaveValue('500');
});
