/**
 * Individual stroke weights on a rectangle: "Per side" turns on one weight for each side, starting at the current weight, and the
 * four side fields change one side each. Figma's Plugin API (update 48) names the per-side properties on rectangles and frames. The
 * bands are rendered and sampled in strokeSides.test.ts; this drives the live panel and reads the sides from the store.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, field, nextPaint } from './helpers';

/** The per-side weights the store holds on the selected rectangle, or undefined when it has one weight. */
async function sidesOf(page: Page) {
  return page.evaluate(() => {
    const store = window.__pigmaStore;
    if (!store) throw new Error('window.__pigmaStore is not exposed');
    const id = store.getState().selection[0];
    const find = (nodes: Array<{ id: string; individualStrokeWeights?: unknown; children?: unknown[] }>): unknown => {
      for (const node of nodes) {
        if (node.id === id) return node.individualStrokeWeights;
        const inside = node.children ? find(node.children as typeof nodes) : undefined;
        if (inside !== undefined) return inside;
      }
      return undefined;
    };
    return find(store.getState().file.document.children as never) as { top: number; right: number; bottom: number; left: number } | undefined;
  });
}

test('B168a Per side gives each side its own weight, and the left field changes only the left side', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 200, 120, 0, 0);
  // A stroke gives the Weight row and the Per side row a place to appear: a rectangle drawn with none has no stroke row.
  await page.evaluate(() => {
    window.__pigmaStore!.getState().updateSelected({ strokes: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1 }], strokeWeight: 1 }, 'Add stroke');
  });
  await nextPaint(page);

  const perSide = page.getByRole('checkbox', { name: 'Individual stroke weights' });
  await expect(perSide).not.toBeChecked();
  await perSide.check();
  await nextPaint(page);
  expect(await sidesOf(page)).toEqual({ top: 1, right: 1, bottom: 1, left: 1 });

  await field(page, 'Stroke left').fill('12');
  await field(page, 'Stroke left').press('Enter');
  await nextPaint(page);
  expect(await sidesOf(page)).toEqual({ top: 1, right: 1, bottom: 1, left: 12 });
});

test('B168b turning Per side off returns the rectangle to one weight, and one undo restores the sides', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 200, 120, 0, 0);
  await page.evaluate(() => {
    window.__pigmaStore!.getState().updateSelected({ strokes: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1 }], strokeWeight: 2 }, 'Add stroke');
  });
  await nextPaint(page);
  const perSide = page.getByRole('checkbox', { name: 'Individual stroke weights' });
  await perSide.check();
  await nextPaint(page);
  expect(await sidesOf(page)).toEqual({ top: 2, right: 2, bottom: 2, left: 2 });

  await perSide.uncheck();
  await nextPaint(page);
  expect(await sidesOf(page)).toBeUndefined();

  // One undo entry: a single undo brings the per-side weights back. Shortcuts are ignored while an INPUT has focus
  // (useKeyboardShortcuts' isTypingTarget), so the checkbox is blurred first.
  await perSide.evaluate((element) => (element as HTMLElement).blur());
  await page.keyboard.press('Control+z');
  await nextPaint(page);
  expect(await sidesOf(page)).toEqual({ top: 2, right: 2, bottom: 2, left: 2 });
});
