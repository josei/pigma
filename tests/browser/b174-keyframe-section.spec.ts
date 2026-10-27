/**
 * Animation section: a key on the selected layer's opacity track at the key time, holding the layer's current opacity. Playback is
 * not built, so this checks the file: the track, its key time and value, and the count the section shows. The model is unit-tested
 * (keyframes.test.ts); this drives the live panel.
 */
import { test, expect } from '@playwright/test';
import { boot, drawShape, nextPaint } from './helpers';

test('B174a the Animation section keys the selected layer\'s opacity at the key time, and counts its keys', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 100, 60, 0, 0);
  await nextPaint(page);

  const section = page.locator('.section', { has: page.locator('.section__header', { hasText: 'Animation' }) });
  await expect(section).toHaveCount(1);
  await expect(section.locator('p')).toHaveText('No opacity keys.');

  const time = section.getByLabel('Key time (ms)', { exact: true });
  await time.fill('500');
  await time.press('Enter');
  await section.getByRole('button', { name: 'Key opacity' }).click();
  await nextPaint(page);

  const track = await page.evaluate(() => {
    const layer = window.__pigmaStore!.getState().file.document.children[0]!.children[0] as unknown as {
      keyframes?: Array<{ property: string; keys: Array<{ time: number; value: number }> }>;
    };
    return layer.keyframes?.find((entry) => entry.property === 'opacity')?.keys ?? [];
  });
  expect(track).toEqual([{ time: 500, value: 1 }]);
  await expect(section.locator('p')).toHaveText('1 opacity key.');
});
