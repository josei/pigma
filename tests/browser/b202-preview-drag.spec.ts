/**
 * Dragging on the animation preview: while the preview is on, a press picks and selects the layer but starts no move, so the stored
 * layer does not change. With the preview off, the same drag from the stored place moves it. The handles sit on the drawn outline.
 */
import { test, expect } from '@playwright/test';
import { boot, drawShape, nextPaint } from './helpers';

async function storedTx(page: import('@playwright/test').Page) {
  return page.evaluate(() => (window.__pigmaStore!.getState().file.document.children[0]!.children[0] as unknown as { transform: { tx: number } }).transform.tx);
}

test('B202a a drag on the preview does not move the stored layer; with the preview off it does', async ({ page }) => {
  await boot(page, { blank: true });
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
  await time.fill('0');
  await time.press('Enter');
  await section.getByRole('button', { name: 'Preview keys' }).click();
  await nextPaint(page);

  const box = (await page.locator('.canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const drawn = { x: cx, y: cy };
  const before = await storedTx(page);
  await page.mouse.move(drawn.x, drawn.y);
  await page.mouse.down();
  await page.mouse.move(drawn.x + 60, drawn.y, { steps: 6 });
  await page.mouse.up();
  await nextPaint(page);
  expect(await storedTx(page), 'a drag on the preview leaves the stored layer where it is').toBe(before);

  await section.getByRole('button', { name: 'Stop preview' }).click();
  await nextPaint(page);
  const turned = { x: cx - 130, y: cy + 70 };
  await page.mouse.move(turned.x, turned.y);
  await page.mouse.down();
  await page.mouse.move(turned.x + 60, turned.y, { steps: 6 });
  await page.mouse.up();
  await nextPaint(page);
  expect(await storedTx(page), 'with the preview off the same drag moves the stored layer').not.toBe(before);
});
