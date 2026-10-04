import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, drag, field, nodeGeometry, tool, zoom, docToScreen } from './helpers';

/** Zoom controls now live in the canvas HUD, not the bottom toolbar. */
function zoomIn(page: Page) {
  return page.locator('button[aria-label="Zoom in"]');
}

/** Pan the viewport with the hand tool so document and screen space diverge. */
async function pan(page: Page, dx: number, dy: number) {
  await tool(page, 'Hand tool').click();
  const box = (await page.locator('.canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy + dy, { steps: 10 });
  await page.mouse.up();
  await tool(page, 'Move').click();
}

test('B15a a drag moves by the exact document delta after zooming in', async ({ page }) => {
  await boot(page, { blank: true });
  const base = await zoom(page);

  await zoomIn(page).click();
  await zoomIn(page).click();
  await expect.poll(async () => zoom(page)).toBeGreaterThan(base);

  await drawShape(page, 'Rectangle', 200, 120);
  await tool(page, 'Move').click();

  const before = await nodeGeometry(page);
  await drag(page, [0, 0], [60, 40], { ctrl: true });
  await page.waitForTimeout(150);
  const after = await nodeGeometry(page);

  const z = await zoom(page);
  expect(Math.abs((after.x - before.x) - 60 / z) / (60 / z)).toBeLessThan(0.03);
  expect(Math.abs((after.y - before.y) - 40 / z) / (40 / z)).toBeLessThan(0.03);
});

test('B15b clicking still hits the node after the canvas is panned', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 200, 120);
  const geom = await nodeGeometry(page);
  const name = (await page.locator('.layer-row--selected .layer-row__name').first().textContent())!;

  await pan(page, 160, 110);

  // Target the node by document coordinates, not by canvas-relative offsets.
  const centre = await docToScreen(page, geom.x + geom.w / 2, geom.y + geom.h / 2);
  await page.mouse.click(centre.x, centre.y);
  await expect(page.locator('.layer-row--selected .layer-row__name').first()).toHaveText(name);
  expect(await field(page, 'W').inputValue()).toBe(String(geom.w));
});

test('B15c a node keeps its geometry when moved offscreen', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 200, 120);
  const name = (await page.locator('.layer-row--selected .layer-row__name').first().textContent())!;
  const before = await nodeGeometry(page);

  // Push the node well outside the viewport.
  await tool(page, 'Move').click();
  await drag(page, [0, 0], [1200, 800], { ctrl: true });
  await page.waitForTimeout(150);
  const moved = await nodeGeometry(page);
  expect(moved.x).toBeGreaterThan(before.x);
  expect(moved.w).toBe(before.w);
  expect(moved.h).toBe(before.h);

  // It is still reachable from the layers panel and keeps its size.
  await page.keyboard.press('Escape');
  await page.locator('.layer-row', { hasText: name }).first().click();
  const after = await nodeGeometry(page);
  expect(after.x).toBe(moved.x);
  expect(after.y).toBe(moved.y);
  expect(after.w).toBe(before.w);
  expect(after.h).toBe(before.h);
});

test('B15d drawing while zoomed produces the right document size', async ({ page }) => {
  await boot(page);
  await zoomIn(page).click();
  await zoomIn(page).click();

  const z = await zoom(page);
  await drawShape(page, 'Rectangle', 200, 120);
  const geom = await nodeGeometry(page);

  expect(Math.abs(geom.w - 200 / z) / (200 / z)).toBeLessThan(0.03);
  expect(Math.abs(geom.h - 120 / z) / (120 / z)).toBeLessThan(0.03);
});

test('B15e a marquee on a panned, blank page still selects', async ({ page }) => {
  await boot(page);
  await page.locator('button[aria-label="Add page"]').click();
  await drawShape(page, 'Rectangle', 120, 120, -160, 0);
  const aName = (await page.locator('.layer-row--selected .layer-row__name').first().textContent())!;
  await drawShape(page, 'Rectangle', 120, 120, 160, 0);
  const bName = (await page.locator('.layer-row--selected .layer-row__name').first().textContent())!;

  const a = await nodeGeometry(page);
  await page.locator('.layer-row', { hasText: aName }).first().click();
  const geomA = await nodeGeometry(page);
  await page.locator('.layer-row', { hasText: bName }).first().click();
  const geomB = await nodeGeometry(page);
  expect(a.w).toBeGreaterThan(0);

  await pan(page, 120, 80);
  await tool(page, 'Move').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.layer-row--selected')).toHaveCount(0);

  // Sweep the real document bounds of both shapes, tracked through the CTM.
  const left = Math.min(geomA.x, geomB.x) - 30;
  const top = Math.min(geomA.y, geomB.y) - 30;
  const right = Math.max(geomA.x + geomA.w, geomB.x + geomB.w) + 30;
  const bottom = Math.max(geomA.y + geomA.h, geomB.y + geomB.h) + 30;
  const from = await docToScreen(page, left, top);
  const to = await docToScreen(page, right, bottom);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();

  await expect(page.locator('.layer-row--selected')).toHaveCount(2);
});
