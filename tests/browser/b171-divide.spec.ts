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

/** Draw the rectangles at the given offsets, select them all, and divide them from the right-click menu. */
async function drawAndDivide(page: Page, offsets: Array<[number, number]>) {
  await boot(page, { blank: true });
  for (const [dx, dy] of offsets) await drawShape(page, 'Rectangle', 160, 120, dx, dy);
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
}

test('B171a Divide turns two overlapping shapes into their three regions', async ({ page }) => {
  await drawAndDivide(page, [
    [0, 0],
    [60, 40],
  ]);
  const pieces = await layers(page);
  // The two lower regions are L-shaped (160 x 120 bounds), and the overlap is 100 x 80.
  expect(pieces.map((piece) => piece.type)).toEqual(['VECTOR', 'VECTOR', 'VECTOR']);
  expect(pieces.map((piece) => [piece.width, piece.height])).toEqual([
    [160, 120],
    [100, 80],
    [160, 120],
  ]);
});

test('B171b Divide turns three overlapping shapes into their seven regions', async ({ page }) => {
  await drawAndDivide(page, [
    [-40, -30],
    [40, -30],
    [0, 40],
  ]);
  const pieces = await layers(page);
  // Each shape is 160 wide. The seven non-empty regions, in order: A alone, A and B, A and C, all three, B alone, B and C, C alone.
  expect(pieces.map((piece) => piece.type)).toEqual(Array(7).fill('VECTOR'));
  expect(pieces.map((piece) => piece.width)).toEqual([80, 80, 40, 80, 80, 40, 160]);
});
