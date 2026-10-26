import { test, expect } from '@playwright/test';
import { boot, drawShape, tool } from './helpers';

/** Flatten (Ctrl/Cmd+E) merges overlapping shapes into one path layer. */
test('B74a Ctrl+E flattens two overlapping shapes into one layer', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 160, 120);
  await drawShape(page, 'Ellipse', 120, 120, 120, 40);
  await tool(page, 'Move').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+e');
  const top = await page.evaluate(() =>
    window.__pigmaStore!.getState().file.document.children[0]!.children.map((c: any) => c.type),
  );
  expect(top, 'the shapes were not merged into one layer').toHaveLength(1);
  expect(top[0]).toBe('VECTOR');
});

test('B74b flatten refuses a single layer, with a reason', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 160, 120);
  await tool(page, 'Move').click();
  await page.keyboard.press('Control+e');
  await expect(page.getByText(/Select two or more shapes, a group/i)).toBeVisible();
});

test('B74c Ctrl+E flattens a group of shapes into one path, and one undo brings the group back', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 160, 120);
  await drawShape(page, 'Ellipse', 120, 120, 120, 40);
  await tool(page, 'Move').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+g');
  const grouped = () => page.evaluate(() => window.__pigmaStore!.getState().file.document.children[0]!.children.map((c: any) => c.type));
  expect(await grouped()).toEqual(['GROUP']);
  await page.keyboard.press('Control+e');
  expect(await grouped(), 'the group did not flatten into one layer').toEqual(['VECTOR']);
  await page.keyboard.press('Control+z');
  expect(await grouped(), 'one undo did not restore the group').toEqual(['GROUP']);
});

test('B74d Ctrl+E flattens a frame into one layer that keeps its name, clipped to the frame', async ({ page }) => {
  await boot(page, { blank: true });
  // Offsets are from the canvas centre. The frame spans x 200..400, y 100..300; the ellipse
  // overhangs its right edge (to x 430), so the clip matters.
  await drawShape(page, 'Frame', 200, 200, 300, 200);
  await drawShape(page, 'Rectangle', 120, 80, 280, 180);
  await drawShape(page, 'Ellipse', 120, 120, 370, 230);
  await tool(page, 'Move').click();
  const frameBox = await page.evaluate(() => {
    const frame = window.__pigmaStore!.getState().file.document.children[0]!.children[0] as any;
    return { id: frame.id, x: frame.transform.tx, y: frame.transform.ty, w: frame.width, h: frame.height, kids: frame.children.map((k: any) => k.type) };
  });
  expect(frameBox.kids, 'the shapes did not land inside the frame').toEqual(['RECTANGLE', 'ELLIPSE']);
  await page.evaluate((id) => window.__pigmaStore!.getState().select([id]), frameBox.id);
  await page.keyboard.press('Control+e');
  const layers = await page.evaluate(() =>
    window.__pigmaStore!.getState().file.document.children[0]!.children.map((c: any) => ({ type: c.type, name: c.name, x: c.transform.tx, y: c.transform.ty, w: c.width, h: c.height })),
  );
  expect(layers, 'the frame did not flatten into one layer').toHaveLength(1);
  expect(layers[0]!.type).toBe('VECTOR');
  expect(layers[0]!.name).toBe('Frame 1');
  // Clipped: the flattened layer stays within the frame, though the ellipse overhung it.
  const eps = 0.5;
  expect(layers[0]!.x).toBeGreaterThanOrEqual(frameBox.x - eps);
  expect(layers[0]!.y).toBeGreaterThanOrEqual(frameBox.y - eps);
  expect(layers[0]!.x + layers[0]!.w, 'the overhang was not clipped').toBeLessThanOrEqual(frameBox.x + frameBox.w + eps);
  expect(layers[0]!.y + layers[0]!.h).toBeLessThanOrEqual(frameBox.y + frameBox.h + eps);
});
