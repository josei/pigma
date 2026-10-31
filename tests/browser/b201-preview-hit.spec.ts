/**
 * Picking on the animation preview: the preview draws the layer where its keys put it at the preview time, and a click picks the layer
 * where it is drawn. Keyed to turn 90 degrees at 500 ms and to be unturned at 0 ms, the layer is drawn unturned at 0 ms: a click on the
 * turned place misses it, a click on the drawn place picks it, and with the preview off the turned place picks it again.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, nextPaint } from './helpers';

async function selectionCount(page: Page) {
  return page.evaluate(() => window.__pigmaStore!.getState().selection.length);
}

test('B201a a click picks the layer where the preview draws it, not where it is stored', async ({ page }) => {
  await boot(page, { blank: true });
  // A 200 by 60 rectangle centred on the canvas, turning about its top-left corner.
  await drawShape(page, 'Rectangle', 200, 60, 0, 0);
  await nextPaint(page);
  const section = page.locator('.section', { has: page.locator('.section__header', { hasText: 'Animation' }) });
  const time = section.getByLabel('Key time (ms)', { exact: true });
  const rotation = page.getByLabel('Rotation', { exact: true }).first();
  await time.fill('0');
  await time.press('Enter');
  await section.getByRole('button', { name: 'Key rotation' }).click();
  await time.fill('500');
  await time.press('Enter');
  await rotation.fill('90');
  await rotation.press('Enter');
  await section.getByRole('button', { name: 'Key rotation' }).click();

  // The stored layer is now turned 90 degrees. Preview it at 0 ms, where it is drawn unturned.
  await time.fill('0');
  await time.press('Enter');
  await section.getByRole('button', { name: 'Preview keys' }).click();
  await nextPaint(page);

  const box = (await page.locator('.canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  // The layer's top-left corner is at (cx - 100, cy - 30). Unturned, its drawn centre is (cx, cy); turned 90 degrees about the corner,
  // its centre is (-30, +100) from that corner.
  const drawn = { x: cx, y: cy };
  const turned = { x: cx - 100 - 30, y: cy - 30 + 100 };

  await page.mouse.click(turned.x, turned.y);
  await nextPaint(page);
  expect(await selectionCount(page), 'the turned place is not drawn during the preview').toBe(0);

  await page.mouse.click(drawn.x, drawn.y);
  await nextPaint(page);
  expect(await selectionCount(page), 'the drawn place picks the layer').toBe(1);

  // The Animation section only shows while the layer is selected, so stop the preview first, then clear the selection.
  await section.getByRole('button', { name: 'Stop preview' }).click();
  await nextPaint(page);
  await page.mouse.click(cx, cy + 300);
  await page.mouse.click(turned.x, turned.y);
  await nextPaint(page);
  expect(await selectionCount(page), 'with the preview off, the stored turned place picks it').toBe(1);
});
