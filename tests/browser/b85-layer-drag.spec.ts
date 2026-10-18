import { test, expect } from '@playwright/test';
import { boot, drawShape, tool } from './helpers';

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

/** A drop beside a row moves the layer into that row's parent, and it keeps its place on the canvas. */
test('B85b a layer dropped above a row inside a group joins that group, and keeps its place', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 80, 80, -120, 0);
  await drawShape(page, 'Ellipse', 80, 80, 0, 0);
  await drawShape(page, 'Polygon', 80, 80, 120, 0);
  // Group the polygon and the rectangle, leaving the ellipse at the top level.
  await page.locator('.app__left .layer-row', { hasText: 'Polygon' }).first().click();
  await page.locator('.app__left .layer-row', { hasText: 'Rectangle' }).first().click({ modifiers: ['Shift'] });
  await page.keyboard.press('Control+g');
  await page.waitForTimeout(250);
  const topLevel = () => page.evaluate(() => (window.__pigmaStore!.getState().file.document.children[0]!.children as Array<{ type: string; children?: Array<{ type: string }> }>).map((n) => ({ type: n.type, kids: (n.children ?? []).map((c) => c.type) })));
  // The ellipse's absolute x, summing the offsets of its ancestors (the moves keep it in place).
  const ellipseId = await page.evaluate(() => (window.__pigmaStore!.getState().file.document.children[0]!.children as any[]).find((n) => n.type === 'ELLIPSE').id as string);
  const ellipseX = () => page.evaluate((id) => {
    const find = (nodes: any[], offset: number): number | null => {
      for (const n of nodes) {
        const x = offset + n.transform.tx;
        if (n.id === id) return x;
        const hit = find(n.children ?? [], x);
        if (hit !== null) return hit;
      }
      return null;
    };
    return find((window.__pigmaStore!.getState().file.document.children[0]!.children as any[]), 0);
  }, ellipseId);
  const before = await topLevel();
  expect(before.map((n) => n.type)).toEqual(['ELLIPSE', 'GROUP']);
  const x = await ellipseX();
  expect(x, 'the ellipse was not found before the move').not.toBeNull();

  // Open the group so its children have rows, then drop the ellipse above one of them.
  const insideRow = page.locator('.app__left .layer-row', { hasText: 'Polygon' }).first();
  if ((await insideRow.count()) === 0) {
    await page.locator('.app__left .layer-row', { hasText: 'Group' }).first().locator('.layer-row__chevron').click();
    await page.waitForTimeout(200);
  }
  await expect(insideRow).toBeVisible();
  const ellipseRow = page.locator('.app__left .layer-row', { hasText: 'Ellipse' }).first();
  await ellipseRow.dragTo(insideRow, { targetPosition: { x: 20, y: 3 } });
  await page.waitForTimeout(250);

  const after = await topLevel();
  expect(after.map((n) => n.type), 'the ellipse did not leave the top level').toEqual(['GROUP']);
  expect(after[0]!.kids, 'the ellipse did not join the group').toContain('ELLIPSE');
  expect(await ellipseX(), 'the ellipse moved on the canvas').toBeCloseTo(x as number, 3);
});

/** Dropping onto the middle of a frame puts the layer inside it. */
test('B85c a layer dropped onto the middle of a frame goes inside it', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Frame', 120, 120, -120, 0);
  await drawShape(page, 'Ellipse', 60, 60, 120, 0);
  await tool(page, 'Move').click();
  const topLevel = () => page.evaluate(() => (window.__pigmaStore!.getState().file.document.children[0]!.children as Array<{ type: string; children?: Array<{ type: string }> }>).map((n) => ({ type: n.type, kids: (n.children ?? []).map((c) => c.type) })));
  expect((await topLevel()).map((n) => n.type)).toEqual(['FRAME', 'ELLIPSE']);

  const frameRow = page.locator('.app__left .layer-row', { hasText: 'Frame' }).first();
  const ellipseRow = page.locator('.app__left .layer-row', { hasText: 'Ellipse' }).first();
  await ellipseRow.dragTo(frameRow, { targetPosition: { x: 40, y: 10 } });
  await page.waitForTimeout(250);

  const after = await topLevel();
  expect(after.map((n) => n.type), 'the ellipse did not leave the top level').toEqual(['FRAME']);
  expect(after[0]!.kids).toEqual(['ELLIPSE']);
});
