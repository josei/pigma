/**
 * Select layer (right-click menu): the layers under the cursor, topmost first, and a row selects its layer. Figma's help
 * article on selecting layers describes the list. The list is unit-tested (layersUnderPoint in tree.test.ts); this
 * drives the live context menu.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, docToScreen, drawShape, nextPaint } from './helpers';

/**
 * Two rectangles that overlap, the second drawn on top. Returns their ids, bottom first, and a document point inside
 * both and a point inside neither. The rectangles are placed where the canvas centre is, so the points come from the store.
 */
async function overlapping(page: Page) {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 100, 100, 0, 0);
  await drawShape(page, 'Rectangle', 100, 100, 20, 20);
  await page.evaluate(() => window.__pigmaStore!.getState().clearSelection());
  await nextPaint(page);
  return page.evaluate(() => {
    const layers = window.__pigmaStore!.getState().file.document.children[0]!.children as Array<{ id: string; transform: { tx: number; ty: number } }>;
    const first = layers[0]!;
    return {
      ids: layers.map((layer) => layer.id),
      inside: { x: first.transform.tx + 50, y: first.transform.ty + 50 },
      outside: { x: first.transform.tx - 60, y: first.transform.ty - 60 },
    };
  });
}

/** Right-click the document point, then open the Select layer list. */
async function openSelectLayer(page: Page, point: { x: number; y: number }) {
  const at = await docToScreen(page, point.x, point.y);
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await nextPaint(page);
  await page.getByText('Select layer', { exact: true }).click();
  await nextPaint(page);
}

test('B160a Select layer lists the layers under the cursor topmost first, and a row selects its layer', async ({ page }) => {
  const { ids: [bottom, top], inside } = await overlapping(page);
  await openSelectLayer(page, inside);
  const rows = page.locator('[data-testid="select-layer-item"]');
  await expect(rows).toHaveCount(2);

  // The top rectangle leads the list, so its row selects the top rectangle.
  await rows.nth(0).click();
  await nextPaint(page);
  expect(await page.evaluate(() => window.__pigmaStore!.getState().selection)).toEqual([top]);

  // The second row is the bottom rectangle, which the list reaches under the top one.
  await page.evaluate(() => window.__pigmaStore!.getState().clearSelection());
  await openSelectLayer(page, inside);
  await page.locator('[data-testid="select-layer-item"]').nth(1).click();
  await nextPaint(page);
  expect(await page.evaluate(() => window.__pigmaStore!.getState().selection)).toEqual([bottom]);
});

test('B160b Select layer is disabled, and says why, where no layer is under the cursor', async ({ page }) => {
  const { outside } = await overlapping(page);
  const at = await docToScreen(page, outside.x, outside.y);
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await nextPaint(page);
  await expect(page.locator('[data-testid="context-menu-item"]', { hasText: 'Select layer' })).toHaveAttribute(
    'data-disabled-reason',
    'no layer is under the cursor',
  );
});
