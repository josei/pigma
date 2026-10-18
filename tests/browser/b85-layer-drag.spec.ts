import { test, expect } from '@playwright/test';
import { boot, drawShape } from './helpers';

/** Layers can be reordered by dragging a row onto another row in the same parent. */
test('B85a dragging a layer above another reorders them, and one undo restores the order', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 80, 80, -120, 0);
  await drawShape(page, 'Ellipse', 80, 80, 0, 0);
  await drawShape(page, 'Polygon', 80, 80, 120, 0);
  const order = () => page.evaluate(() => (window.__pigmaStore!.getState().file.document.children[0]!.children as Array<{ type: string }>).map((n) => n.type));
  const before = await order();
  expect(before).toEqual(['RECTANGLE', 'ELLIPSE', 'POLYGON']);

  // The panel lists the front layer on top, so Rectangle (bottom of the data) sits at the bottom of the panel.
  // Drag the bottom row (Rectangle) onto the top half of the top row (Polygon): it lands ABOVE Polygon in the panel.
  const rows = page.locator('.app__left .layer-row');
  const polygonRow = rows.filter({ hasText: 'Polygon' }).first();
  const rectangleRow = rows.filter({ hasText: 'Rectangle' }).first();
  await rectangleRow.dragTo(polygonRow, { targetPosition: { x: 20, y: 3 } });
  await page.waitForTimeout(250);

  expect(await order(), 'the dragged layer did not move to the front').toEqual(['ELLIPSE', 'POLYGON', 'RECTANGLE']);

  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  expect(await order(), 'one undo did not restore the order').toEqual(before);
});

/** A layer cannot be dropped into another parent by the layers panel: that is refused. */
test('B85b a drop onto a layer in a different parent is refused, and the tree is unchanged', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 80, 80, -120, 0);
  await drawShape(page, 'Ellipse', 80, 80, 0, 0);
  await drawShape(page, 'Polygon', 80, 80, 120, 0);
  // Group the two rectangles and the polygon's neighbour, leaving the ellipse at the top level.
  await page.locator('.app__left .layer-row', { hasText: 'Polygon' }).first().click();
  await page.locator('.app__left .layer-row', { hasText: 'Rectangle' }).first().click({ modifiers: ['Shift'] });
  await page.keyboard.press('Control+g');
  await page.waitForTimeout(250);
  const topLevel = () => page.evaluate(() => (window.__pigmaStore!.getState().file.document.children[0]!.children as Array<{ type: string; children?: Array<{ type: string }> }>).map((n) => ({ type: n.type, kids: (n.children ?? []).map((c) => c.type) })));
  const before = await topLevel();
  expect(before.map((n) => n.type)).toEqual(['ELLIPSE', 'GROUP']);

  // Open the group so its children have rows, then drag the top-level ellipse onto one of them.
  const insideRow = page.locator('.app__left .layer-row', { hasText: 'Polygon' }).first();
  if ((await insideRow.count()) === 0) {
    await page.locator('.app__left .layer-row', { hasText: 'Group' }).first().locator('.layer-row__chevron').click();
    await page.waitForTimeout(200);
  }
  await expect(insideRow).toBeVisible();
  const ellipseRow = page.locator('.app__left .layer-row', { hasText: 'Ellipse' }).first();
  await ellipseRow.dragTo(insideRow, { targetPosition: { x: 20, y: 3 } });
  await page.waitForTimeout(250);
  expect(await topLevel(), 'a layer moved into a different parent').toEqual(before);
});
