/**
 * Ruler guides (Figma's "Add guides to the canvas"): with the rulers shown, a drag from the top ruler makes a
 * horizontal guide and a drag from the left ruler a vertical one. A guide is moved by dragging it, and removed by
 * dragging it back onto a ruler. The model is unit-tested (guides.test.ts); this drives the live canvas.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, canvasBox, drawShape } from './helpers';

async function rulersOn(page: Page) {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 80, 60, -200, 0);
  // The rulers are on by default; Shift+R would turn them off.
  await expect(page.locator('[data-testid="ruler-drag-y"]')).toHaveCount(1);
}

/** A press-move-release on the canvas, in small steps so the pointer moves through the strip. */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

test('B116a a drag from the top ruler makes a horizontal guide where it is dropped', async ({ page }) => {
  await rulersOn(page);
  const box = await canvasBox(page);
  await drag(page, { x: box.x + 200, y: box.y + 10 }, { x: box.x + 200, y: box.y + 220 });
  await expect(page.locator('[data-testid="guide-line"]')).toHaveCount(1);
  const line = page.locator('[data-testid="guide-line"]').first();
  expect(await line.getAttribute('y1')).toBe(await line.getAttribute('y2'));
});

test('B116b a drag from the left ruler makes a vertical guide, and a guide dragged onto a ruler is removed', async ({ page }) => {
  await rulersOn(page);
  const box = await canvasBox(page);
  await drag(page, { x: box.x + 10, y: box.y + 200 }, { x: box.x + 260, y: box.y + 200 });
  await expect(page.locator('[data-testid="guide-line"]')).toHaveCount(1);
  const line = page.locator('[data-testid="guide-line"]').first();
  expect(await line.getAttribute('x1')).toBe(await line.getAttribute('x2'));

  // Drag the guide back onto the left ruler: it is removed.
  await drag(page, { x: box.x + 260, y: box.y + 300 }, { x: box.x + 8, y: box.y + 300 });
  await expect(page.locator('[data-testid="guide-line"]')).toHaveCount(0);
});

test('B116c a guide is moved by dragging it, and one undo puts it back', async ({ page }) => {
  await rulersOn(page);
  const box = await canvasBox(page);
  await drag(page, { x: box.x + 200, y: box.y + 10 }, { x: box.x + 200, y: box.y + 150 });
  const line = page.locator('[data-testid="guide-line"]').first();
  const before = Number(await line.getAttribute('y1'));

  await drag(page, { x: box.x + 300, y: box.y + before }, { x: box.x + 300, y: box.y + before + 70 });
  await expect.poll(async () => Number(await page.locator('[data-testid="guide-line"]').first().getAttribute('y1'))).toBeGreaterThan(before + 50);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => Number(await page.locator('[data-testid="guide-line"]').first().getAttribute('y1'))).toBeCloseTo(before, 0);
});
