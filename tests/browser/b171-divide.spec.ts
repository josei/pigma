/**
 * Divide, from the right-click menu: two overlapping shapes become their regions, each a flat vector layer, and the shapes are
 * gone. The geometry is unit-tested (divide.test.ts); this drives the live context menu and reads the layers from the store.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, nextPaint } from './helpers';

/** The page's layers, as their types and sizes, from the store. */
async function layers(page: Page) {
  return page.evaluate(() =>
    (window.__pigmaStore!.getState().file.document.children[0]!.children as unknown as Array<{ type: string; width: number; height: number }>).map(
      (layer) => ({ type: layer.type, width: Math.round(layer.width), height: Math.round(layer.height) }),
    ),
  );
}

test('B171a Divide turns two overlapping shapes into their three regions', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 160, 120, 0, 0);
  await drawShape(page, 'Rectangle', 160, 120, 60, 40);
  await page.evaluate(() => {
    const store = window.__pigmaStore!;
    const ids = (store.getState().file.document.children[0]!.children as unknown as Array<{ id: string }>).map((layer) => layer.id);
    store.getState().select(ids, 'replace');
  });
  await nextPaint(page);

  const box = (await page.locator('.canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  await nextPaint(page);
  await page.getByText('Divide selection', { exact: true }).click();
  await nextPaint(page);

  const pieces = await layers(page);
  // The two lower regions are L-shaped (160 x 120 bounds), and the overlap is 100 x 80.
  expect(pieces.map((piece) => piece.type)).toEqual(['VECTOR', 'VECTOR', 'VECTOR']);
  expect(pieces.map((piece) => [piece.width, piece.height])).toEqual([
    [160, 120],
    [100, 80],
    [160, 120],
  ]);
});
