import { test, expect } from '@playwright/test';
import { boot, drawShape, tool } from './helpers';

/** The selected node, read from the store (the source of truth). */
const selected = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const s = window.__pigmaStore!.getState();
    const find = (n: any, id: string): any => (n.id === id ? n : (n.children ?? []).map((c: any) => find(c, id)).find(Boolean));
    const node = find(s.file.document, s.selection[0]!);
    const parent = (n: any, id: string): any =>
      (n.children ?? []).some((c: any) => c.id === id) ? n : (n.children ?? []).map((c: any) => parent(c, id)).find(Boolean);
    return { type: node.type, opacity: node.opacity ?? 1, layoutMode: node.autoLayout?.layoutMode ?? 'NONE', parentType: parent(s.file.document, node.id)?.type };
  });

test('B61a number keys set opacity like Figma (5 = 50%, 0 = 100%)', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 160, 120);
  await tool(page, 'Move').click();
  await page.keyboard.press('5');
  expect((await selected(page)).opacity).toBeCloseTo(0.5, 5);
  await page.keyboard.press('0');
  expect((await selected(page)).opacity).toBe(1);
});

test('B61b Shift+A wraps a plain layer in an auto layout frame', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 160, 120);
  await tool(page, 'Move').click();
  await page.keyboard.press('Shift+A');
  const node = await selected(page);
  expect(node.type).toBe('FRAME');
  expect(node.layoutMode).toBe('HORIZONTAL');
  // One undo entry removes the auto layout; the wrapper is a separate step, so undo twice restores the bare layer.
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  const after = await selected(page);
  expect(after.type).toBe('RECTANGLE');
});

test('B61c Shift+A on a frame adds auto layout in place', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Frame', 200, 160);
  await tool(page, 'Move').click();
  await page.keyboard.press('Shift+A');
  const node = await selected(page);
  expect(node.type).toBe('FRAME');
  expect(node.layoutMode).toBe('HORIZONTAL');
});

const fillOf = (page: import('@playwright/test').Page, index: number) =>
  page.evaluate((i) => {
    const s = window.__pigmaStore!.getState();
    const node = s.file.document.children[0]!.children[i] as any;
    return { fill: JSON.stringify(node.fills), opacity: node.opacity ?? 1, w: node.width, name: node.name, visible: node.visible, locked: node.locked };
  }, index);

test('B61d copy / paste properties moves appearance only', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 120, 100);
  await drawShape(page, 'Ellipse', 300, 100);
  await tool(page, 'Move').click();
  const [rect, ellipse] = [await fillOf(page, 0), await fillOf(page, 1)];
  // Give the ellipse (selected) a distinctive opacity, copy its properties, paste on the rectangle.
  await page.keyboard.press('3');
  await page.keyboard.press('Control+Alt+c');
  await page.evaluate(() => {
    const s = window.__pigmaStore!.getState();
    s.select([s.file.document.children[0]!.children[0]!.id]);
  });
  await page.keyboard.press('Control+Alt+v');
  const after = await fillOf(page, 0);
  expect(after.opacity).toBeCloseTo(0.3, 5);
  expect(after.w, 'pasting properties changed the size').toBe(rect.w);
  expect(after.name, 'pasting properties renamed the layer').toBe(rect.name);
  expect(ellipse.opacity).toBe(1);
});

test('B61e Ctrl+Shift+H hides and Ctrl+Shift+L locks the selection', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 160, 120);
  await tool(page, 'Move').click();
  await page.keyboard.press('Control+Shift+h');
  expect((await fillOf(page, 0)).visible).toBe(false);
  await page.keyboard.press('Control+Shift+h');
  expect((await fillOf(page, 0)).visible).toBe(true);
  await page.keyboard.press('Control+Shift+l');
  expect((await fillOf(page, 0)).locked).toBe(true);
});

test('B61f Ctrl+Alt+G frames the selection', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 160, 120);
  await tool(page, 'Move').click();
  await page.keyboard.press('Control+Alt+g');
  expect((await selected(page)).type).toBe('FRAME');
});
