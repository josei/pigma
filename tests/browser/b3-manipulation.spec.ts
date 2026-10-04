import { test, expect } from '@playwright/test';
import {
  boot,
  drawShape,
  field,
  toDoc,
  drag,
  tool,
  nwHandle,
  nodeGeometry,
  docToScreen,
  zoom,
} from './helpers';

/**
 * Free drag, snapping bypassed with Ctrl: the node must move by exactly the
 * pointer delta converted to document units, on both axes.
 */
test('B3a a free drag moves the node by the exact delta on both axes', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 200, 120);
  await tool(page, 'Move').click();

  const before = await nodeGeometry(page);
  await drag(page, [0, 0], [60, 40], { ctrl: true });
  await page.waitForTimeout(150);
  const after = await nodeGeometry(page);

  const dx = after.x - before.x;
  const dy = after.y - before.y;
  const expectedX = await toDoc(page, 60);
  const expectedY = await toDoc(page, 40);

  expect(Math.abs(dx - expectedX) / expectedX).toBeLessThan(0.02);
  expect(Math.abs(dy - expectedY) / expectedY).toBeLessThan(0.02);
});

// Snapping drags involve extra pointer steps; give them room.
test.describe.configure({ timeout: 60_000 });

test('B3b smart snapping pulls a dragged edge onto a neighbour', async ({ page }) => {
  await boot(page);
  // A blank page keeps the snap targets limited to the two shapes we draw.
  await page.locator('button[aria-label="Add page"]').click();
  await drawShape(page, 'Rectangle', 160, 100, -220, 0);
  const anchor = await nodeGeometry(page);
  await drawShape(page, 'Rectangle', 160, 100, 220, 0);
  const mover = await nodeGeometry(page);
  await tool(page, 'Move').click();

  // Aim the mover so its top edge misses the anchor's top edge by 10 document
  // units — inside the 6px screen snap threshold — then drag it there.
  const z = await zoom(page);
  const miss = 10;
  const start = await docToScreen(page, mover.x + mover.w / 2, mover.y + mover.h / 2);
  const target = await docToScreen(page, mover.x + mover.w / 2, anchor.y + miss + mover.h / 2);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 10 });
  const guideCount = await page.locator('.canvas__guide').count();
  await page.mouse.up();
  await page.waitForTimeout(150);

  const snapped = await nodeGeometry(page);
  expect(z).toBeGreaterThan(0);
  expect(guideCount).toBeGreaterThan(0);
  // Snapped flush with the anchor instead of resting 10 units below it.
  expect(Math.abs(snapped.y - anchor.y)).toBeLessThan(1);
});

test('B3c snapping can be bypassed with Ctrl', async ({ page }) => {
  await boot(page);
  await page.locator('button[aria-label="Add page"]').click();
  await drawShape(page, 'Rectangle', 160, 100, -220, 0);
  const anchor = await nodeGeometry(page);
  await drawShape(page, 'Rectangle', 160, 100, 220, 0);
  const mover = await nodeGeometry(page);
  await tool(page, 'Move').click();

  const miss = 10;
  const start = await docToScreen(page, mover.x + mover.w / 2, mover.y + mover.h / 2);
  const target = await docToScreen(page, mover.x + mover.w / 2, anchor.y + miss + mover.h / 2);
  await page.keyboard.down('Control');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 10 });
  const guideCount = await page.locator('.canvas__guide').count();
  await page.mouse.up();
  await page.keyboard.up('Control');
  await page.waitForTimeout(150);

  const free = await nodeGeometry(page);
  expect(guideCount).toBe(0);
  // Without snapping the mover keeps the ~10 unit offset.
  expect(Math.abs(free.y - anchor.y)).toBeGreaterThan(4);
});

test('B3d dragging the NW handle resizes and pins the opposite corner', async ({ page }) => {
  await boot(page);
  await drawShape(page, 'Rectangle', 200, 120);
  await tool(page, 'Move').click();

  const x0 = Number(await field(page, 'X').inputValue());
  const y0 = Number(await field(page, 'Y').inputValue());
  const w0 = Number(await field(page, 'W').inputValue());
  const h0 = Number(await field(page, 'H').inputValue());

  const hb = (await nwHandle(page).boundingBox())!;
  const hx = hb.x + hb.width / 2;
  const hy = hb.y + hb.height / 2;
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  await page.mouse.move(hx - 40, hy - 30, { steps: 10 });
  await page.mouse.up();

  const dw = Number(await field(page, 'W').inputValue()) - w0;
  const dh = Number(await field(page, 'H').inputValue()) - h0;
  const dx = Number(await field(page, 'X').inputValue()) - x0;
  const dy = Number(await field(page, 'Y').inputValue()) - y0;

  expect(dw).toBeGreaterThan(0);
  expect(dh).toBeGreaterThan(0);
  // Growing from the NW corner pins the SE corner: the size grows by exactly
  // the amount the origin moves. Both sides share the same scale, so this holds
  // regardless of zoom.
  expect(dx).toBeCloseTo(-dw, 0);
  expect(dy).toBeCloseTo(-dh, 0);
});

test('B3e resize never produces a negative or zero size', async ({ page }) => {
  await boot(page);
  await drawShape(page, 'Rectangle', 120, 120);
  await tool(page, 'Move').click();

  const hb = (await nwHandle(page).boundingBox())!;
  const hx = hb.x + hb.width / 2;
  const hy = hb.y + hb.height / 2;
  // Drag the NW handle far past the SE corner.
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  await page.mouse.move(hx + 400, hy + 400, { steps: 12 });
  await page.mouse.up();

  expect(Number(await field(page, 'W').inputValue())).toBeGreaterThan(0);
  expect(Number(await field(page, 'H').inputValue())).toBeGreaterThan(0);
});

test('B3f arrow keys nudge by 1px, shift+arrow by 10px', async ({ page }) => {
  await boot(page);
  await drawShape(page, 'Rectangle', 200, 120);
  await tool(page, 'Move').click();

  const x0 = Number(await field(page, 'X').inputValue());
  await page.keyboard.press('ArrowRight');
  expect(Number(await field(page, 'X').inputValue())).toBeCloseTo(x0 + 1, 0);

  const x1 = Number(await field(page, 'X').inputValue());
  await page.keyboard.press('Shift+ArrowRight');
  expect(Number(await field(page, 'X').inputValue())).toBeCloseTo(x1 + 10, 0);
});
