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
