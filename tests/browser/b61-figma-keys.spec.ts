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

test('B61g copy properties carries text style to a text layer only', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 120, 100);
  await page.keyboard.press('t');
  await page.mouse.click(400, 300);
  await page.keyboard.type('Hi');
  await page.keyboard.press('Escape');
  await tool(page, 'Move').click();
  // Copy the text layer's style, paste onto the rectangle: the rectangle must not gain a text style.
  const textIndex = await page.evaluate(() => window.__pigmaStore!.getState().file.document.children[0]!.children.findIndex((c: any) => c.type === 'TEXT'));
  await page.evaluate((i) => {
    const s = window.__pigmaStore!.getState();
    s.select([s.file.document.children[0]!.children[i]!.id]);
  }, textIndex);
  await page.keyboard.press('Control+Alt+c');
  await page.evaluate(() => {
    const s = window.__pigmaStore!.getState();
    const rect = s.file.document.children[0]!.children.find((c: any) => c.type === 'RECTANGLE')!;
    s.select([rect.id]);
  });
  await page.keyboard.press('Control+Alt+v');
  const rect = await page.evaluate(() => {
    const r = window.__pigmaStore!.getState().file.document.children[0]!.children.find((c: any) => c.type === 'RECTANGLE') as any;
    return { hasStyle: 'style' in r, type: r.type };
  });
  expect(rect.type).toBe('RECTANGLE');
  expect(rect.hasStyle, 'a rectangle gained a text style').toBe(false);
});

test('B61h copy properties moves a text layer\'s size onto another text layer', async ({ page }) => {
  await boot(page, { blank: true });
  for (const [x, y, word] of [[400, 260, 'One'], [400, 420, 'Two']] as const) {
    await page.keyboard.press('t');
    await page.mouse.click(x, y);
    await page.keyboard.type(word);
    await page.keyboard.press('Escape');
  }
  await tool(page, 'Move').click();
  const sizes = () =>
    page.evaluate(() =>
      window.__pigmaStore!.getState().file.document.children[0]!.children
        .filter((c: any) => c.type === 'TEXT')
        .map((c: any) => c.style.fontSize),
    );
  const ids = () =>
    page.evaluate(() =>
      window.__pigmaStore!.getState().file.document.children[0]!.children
        .filter((c: any) => c.type === 'TEXT')
        .map((c: any) => c.id),
    );
  const [first, second] = await ids();
  await page.evaluate((id) => {
    const s = window.__pigmaStore!.getState();
    s.select([id]);
    const current = s.file.document.children[0]!.children.find((c: any) => c.id === id) as unknown as { style: object };
    s.updateSelected({ style: { ...current.style, fontSize: 32 } } as never, 'Set size');
  }, first!);
  await page.evaluate((id) => window.__pigmaStore!.getState().select([id]), first!);
  await page.keyboard.press('Control+Alt+c');
  await page.evaluate((id) => window.__pigmaStore!.getState().select([id]), second!);
  await page.keyboard.press('Control+Alt+v');
  expect(await sizes(), 'the text size did not carry over').toEqual([32, 32]);
});

test('B61i hide on a mixed selection sets every layer to one state, undone in one step', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 120, 100);
  await drawShape(page, 'Ellipse', 100, 80, 300, 0);
  // Hide only the rectangle first, so the selection is mixed: one visible, one hidden.
  await page.evaluate(() => {
    const s = window.__pigmaStore!.getState();
    s.toggleVisible(s.file.document.children[0]!.children[0]!.id);
  });
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+Shift+h');
  const vis = () =>
    page.evaluate(() => window.__pigmaStore!.getState().file.document.children[0]!.children.map((c: any) => c.visible));
  expect(await vis(), 'a mixed selection did not converge to one state').toEqual([false, false]);
  await page.keyboard.press('Control+z');
  expect(await vis(), 'one undo did not restore the layers').toEqual([false, true]);
});

test('B61j Shift+A on two layers wraps both in one auto layout frame', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 120, 100);
  await drawShape(page, 'Ellipse', 100, 80, 300, 0);
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Shift+A');
  const result = await page.evaluate(() => {
    const s = window.__pigmaStore!.getState();
    const top = s.file.document.children[0]!.children;
    const frame = top.find((c: any) => c.type === 'FRAME') as any;
    return { topTypes: top.map((c: any) => c.type), kids: frame?.children.length ?? 0, mode: frame?.autoLayout?.layoutMode };
  });
  expect(result.topTypes).toEqual(['FRAME']);
  expect(result.kids).toBe(2);
  expect(result.mode).toBe('HORIZONTAL');
});

test('B61k Alt-drag draws a shape from its centre', async ({ page }) => {
  await boot(page, { blank: true });
  const last = () =>
    page.evaluate(() => {
      const kids = window.__pigmaStore!.getState().file.document.children[0]!.children as any[];
      const node = kids[kids.length - 1];
      return { w: node.width, h: node.height, x: node.transform.tx, y: node.transform.ty };
    });
  // A plain corner drag from (500,400): its top-left is the press point in world space.
  await page.keyboard.press('r');
  await page.mouse.move(500, 400);
  await page.mouse.down();
  await page.mouse.move(600, 460, { steps: 5 });
  await page.mouse.up();
  const corner = await last();
  // The same press with Alt draws from the centre: the press point is the middle.
  await page.keyboard.press('r');
  await page.keyboard.down('Alt');
  await page.mouse.move(500, 400);
  await page.mouse.down();
  await page.mouse.move(600, 460, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  const centred = await last();
  expect(Math.abs(centred.w - corner.w * 2), 'the width is not doubled from the centre').toBeLessThan(4);
  expect(Math.abs(centred.h - corner.h * 2), 'the height is not doubled from the centre').toBeLessThan(4);
  expect(Math.abs(centred.x + centred.w / 2 - corner.x)).toBeLessThan(4);
  expect(Math.abs(centred.y + centred.h / 2 - corner.y)).toBeLessThan(4);
});
