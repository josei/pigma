/**
 * Rotate copies, from the Rotate copies section: a selected layer gets the given number of copies, the k-th turned k times the
 * angle around the selection's bottom-centre. The geometry is unit-tested (rotateCopies.test.ts); this drives the live panel
 * and reads the layers' rotations from the store.
 */
import { test, expect } from '@playwright/test';
import { boot, drawShape, nextPaint } from './helpers';

test('B170a Rotate copies adds the copies, turned by the angle each time, and keeps the original', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 120, 60, 0, 0);
  await nextPaint(page);

  const section = page.locator('.section', { has: page.locator('.section__header', { hasText: 'Rotate copies' }) });
  const copies = section.getByLabel('Copies', { exact: true });
  await copies.fill('3');
  await copies.press('Enter');
  const angle = section.getByLabel('Turn per copy', { exact: true });
  await angle.fill('90');
  await angle.press('Enter');
  await nextPaint(page);
  await section.getByRole('button', { name: 'Rotate copies' }).click();
  await nextPaint(page);

  const layers = await page.evaluate(() => {
    const layers = window.__pigmaStore!.getState().file.document.children[0]!.children as unknown as Array<{
      transform: { a: number; b: number };
    }>;
    return layers.map((layer) => Math.round((Math.atan2(layer.transform.b, layer.transform.a) * 180) / Math.PI));
  });
  // The original is unturned, and the three copies sit at 90, 180 and -90 degrees (the same as 270).
  expect(layers).toHaveLength(4);
  expect(layers.filter((degrees) => degrees === 0)).toHaveLength(1);
  expect(layers.filter((degrees) => degrees !== 0).sort((a, b) => a - b)).toEqual([-90, 90, 180]);
});
