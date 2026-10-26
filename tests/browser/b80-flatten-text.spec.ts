import { test, expect } from '@playwright/test';
import { boot, docToScreen, drawShape, tool } from './helpers';

/** Flatten turns a frame's text into outlines, so the frame becomes one vector layer. */
test('B80a Ctrl+E flattens a frame holding text into one outlined layer', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Frame', 300, 200, 200, 200);
  const frame = await page.evaluate(() => {
    const node = window.__pigmaStore!.getState().file.document.children[0]!.children[0] as any;
    return { id: node.id, x: node.transform.tx, y: node.transform.ty, w: node.width, h: node.height };
  });
  // Type inside the frame, so the text lands in it.
  const at = await docToScreen(page, frame.x + 40, frame.y + 60);
  await page.keyboard.press('t');
  await page.mouse.click(at.x, at.y);
  await page.keyboard.type('Hi');
  await page.keyboard.press('Escape');
  await tool(page, 'Move').click();
  const kids = await page.evaluate(() => (window.__pigmaStore!.getState().file.document.children[0]!.children[0] as any).children.map((c: any) => c.type));
  expect(kids, 'the text did not land inside the frame').toEqual(['TEXT']);

  await page.evaluate((id) => window.__pigmaStore!.getState().select([id]), frame.id);
  await page.keyboard.press('Control+e');
  const layers = await page.evaluate(() =>
    window.__pigmaStore!.getState().file.document.children[0]!.children.map((c: any) => ({ type: c.type, name: c.name, path: c.pathData ?? '' })),
  );
  expect(layers, 'the frame did not flatten into one layer').toHaveLength(1);
  expect(layers[0]!.type).toBe('VECTOR');
  expect(layers[0]!.name).toBe('Frame 1');
  expect(layers[0]!.path, 'the text did not become outlines').toMatch(/^M/);
  // The outlined text is drawn on the canvas as a path, not as a text element.
  await expect(page.locator('.canvas__svg text', { hasText: 'Hi' })).toHaveCount(0);
});

test('B80b Ctrl+E on a single text layer is refused with a reason, as before', async ({ page }) => {
  await boot(page, { blank: true });
  await page.keyboard.press('t');
  await page.mouse.click(420, 260);
  await page.keyboard.type('Hi');
  await page.keyboard.press('Escape');
  await tool(page, 'Move').click();
  await page.keyboard.press('Control+e');
  await expect(page.getByText(/Select two or more shapes, a group/i)).toBeVisible();
});
