/**
 * Outline stroke, from the right-click menu: a layer's stroke becomes a filled vector layer above it, painted with the stroke, and
 * the layer loses its stroke. The geometry is unit-tested (outline.test.ts); this drives the live context menu and reads the
 * layers from the store.
 */
import { test, expect } from '@playwright/test';
import { boot, drag, drawShape, nextPaint, tool } from './helpers';

test('B172a Outline stroke moves a layer stroke onto a filled vector layer above it', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 100, 50, 0, 0);
  await page.evaluate(() => {
    const store = window.__pigmaStore!;
    const id = (store.getState().file.document.children[0]!.children[0] as unknown as { id: string }).id;
    store.getState().select([id], 'replace');
    store.getState().updateSelected({ strokes: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 1 }], strokeWeight: 10 }, 'Stroke');
  });
  await nextPaint(page);

  const box = (await page.locator('.canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  await nextPaint(page);
  await page.getByText('Outline stroke', { exact: true }).click();
  await nextPaint(page);

  const layers = await page.evaluate(() =>
    (window.__pigmaStore!.getState().file.document.children[0]!.children as unknown as Array<{
      type: string;
      width: number;
      strokes: unknown[];
      fills: Array<{ color?: { r: number } }>;
    }>).map((layer) => ({ type: layer.type, width: Math.round(layer.width), strokes: layer.strokes.length, fill: layer.fills[0]?.color?.r })),
  );
  // The rectangle keeps its (default, none) fill and loses its stroke; the outline sits above it, filled with the black stroke.
  expect(layers.map((layer) => layer.type)).toEqual(['RECTANGLE', 'VECTOR']);
  expect(layers[0]!.strokes).toBe(0);
  expect(layers[1]!.strokes).toBe(0);
  expect(layers[1]!.fill).toBe(0);
  // An inside stroke lies within the 100-wide rectangle.
  expect(layers[1]!.width).toBe(100);
});

test('B172b Outline stroke of a dashed stroke makes the dashes as a vector, and the layer loses its stroke', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 100, 50, 0, 0);
  await page.evaluate(() => {
    const store = window.__pigmaStore!;
    const id = (store.getState().file.document.children[0]!.children[0] as unknown as { id: string }).id;
    store.getState().select([id], 'replace');
    store.getState().updateSelected(
      { strokes: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 1 }], strokeWeight: 10, dashPattern: [10, 5] },
      'Stroke',
    );
  });
  await nextPaint(page);

  const box = (await page.locator('.canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  await nextPaint(page);
  await page.getByText('Outline stroke', { exact: true }).click();
  await nextPaint(page);

  const layers = await page.evaluate(() =>
    (window.__pigmaStore!.getState().file.document.children[0]!.children as unknown as Array<{ type: string; strokes: unknown[] }>).map(
      (layer) => ({ type: layer.type, strokes: layer.strokes.length }),
    ),
  );
  expect(layers).toEqual([
    { type: 'RECTANGLE', strokes: 0 },
    { type: 'VECTOR', strokes: 0 },
  ]);
});

test('B172c Outline stroke of a line makes its stroke a filled vector above it', async ({ page }) => {
  await boot(page, { blank: true });
  await tool(page, 'Line').click();
  await drag(page, [-100, 0], [100, 0]);
  await nextPaint(page);
  await page.evaluate(() => {
    const store = window.__pigmaStore!;
    const id = (store.getState().file.document.children[0]!.children[0] as unknown as { id: string }).id;
    store.getState().select([id], 'replace');
    store.getState().updateSelected({ strokeWeight: 10 }, 'Stroke');
  });
  await nextPaint(page);

  const box = (await page.locator('.canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2 - 40, { button: 'right' });
  await nextPaint(page);
  await page.getByText('Outline stroke', { exact: true }).click();
  await nextPaint(page);

  const layers = await page.evaluate(() =>
    (window.__pigmaStore!.getState().file.document.children[0]!.children as unknown as Array<{ type: string; width: number; strokes: unknown[] }>).map(
      (layer) => ({ type: layer.type, width: Math.round(layer.width), strokes: layer.strokes.length }),
    ),
  );
  expect(layers.map((layer) => layer.type)).toEqual(['LINE', 'VECTOR']);
  // The line keeps its 200 length, and its outline is the 10-wide band along it.
  expect(layers[1]!.width).toBe(200);
  expect(layers[0]!.strokes).toBe(0);
});
