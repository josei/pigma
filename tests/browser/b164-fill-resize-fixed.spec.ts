/**
 * A manual resize of a child that fills its auto layout frame switches that axis to Fixed, as Figma's help article says:
 * "Dragging a layer's edge or typing a width or height switches that axis to Fixed." Before this the layout put the size back
 * on the next settle, so the drag or the typed value was lost. The rule is unit-tested (fixResizedAxes in autoLayout.test.ts);
 * this drags the live handle and types into the live W field, then reads the child from the store and the panel.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, docToScreen, drawShape, field, nextPaint } from './helpers';

/** The width and fill flags of the selected child, read from the store. */
async function childState(page: Page) {
  return page.evaluate(() => {
    const store = window.__pigmaStore;
    if (!store) throw new Error('window.__pigmaStore is not exposed');
    const frame = store.getState().file.document.children[0]!.children[0] as unknown as {
      transform: { tx: number; ty: number };
      children: Array<{ id: string; width: number; height: number; layoutGrow?: number; layoutAlign?: string; transform: { tx: number; ty: number } }>;
    };
    const child = frame.children[1]!;
    return {
      width: child.width,
      height: child.height,
      layoutGrow: child.layoutGrow ?? 0,
      // Absolute box of the child: the frame sits at the origin of the page's own coordinates.
      x: frame.transform.tx + child.transform.tx,
      y: frame.transform.ty + child.transform.ty,
    };
  });
}

/** Draw a fixed row frame with two rectangles, and select the second rectangle. */
async function rowWithSecondSelected(page: Page) {
  await boot(page, { blank: true });
  await drawShape(page, 'Frame', 420, 300, 0, 0);
  await page.evaluate(() => {
    window.__pigmaStore!.getState().setAutoLayout({ layoutMode: 'HORIZONTAL', primaryAxisSizingMode: 'FIXED', counterAxisSizingMode: 'FIXED' });
  });
  await nextPaint(page);
  await drawShape(page, 'Rectangle', 100, 80, -110, -50);
  await drawShape(page, 'Rectangle', 100, 80, 110, 50);
  await page.evaluate(() => {
    const store = window.__pigmaStore!;
    const frame = store.getState().file.document.children[0]!.children[0] as unknown as { children: Array<{ id: string }> };
    store.getState().select([frame.children[1]!.id], 'replace');
  });
  await nextPaint(page);
  const section = page.locator('.section', { has: page.locator('.section__header', { hasText: 'Auto layout child' }) });
  await section.locator('.segmented__option', { hasText: 'Fill' }).nth(0).click();
  await nextPaint(page);
  return section;
}

test('B164a dragging the east edge of a filling child sets its width and switches the width to Fixed', async ({ page }) => {
  const section = await rowWithSecondSelected(page);
  const filled = await childState(page);
  expect(filled.layoutGrow).toBe(1);

  // The east handle sits at the child's right edge, halfway down. Drag it 40 units to the right.
  const from = await docToScreen(page, filled.x + filled.width, filled.y + filled.height / 2);
  const to = await docToScreen(page, filled.x + filled.width + 40, filled.y + filled.height / 2);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await nextPaint(page);

  const after = await childState(page);
  expect(after.width, 'the drag was undone by the layout').toBeCloseTo(filled.width + 40, 0);
  expect(after.layoutGrow).toBe(0);
  await expect(section.locator('.segmented__option--active', { hasText: 'Fixed' }).nth(0)).toBeVisible();
});

test('B164b typing a width into a filling child switches its width to Fixed and keeps the typed value', async ({ page }) => {
  const section = await rowWithSecondSelected(page);
  await field(page, 'W').fill('150');
  await field(page, 'W').press('Enter');
  await nextPaint(page);

  const after = await childState(page);
  expect(after.width).toBe(150);
  expect(after.layoutGrow).toBe(0);
  await expect(section.locator('.segmented__option--active', { hasText: 'Fixed' }).nth(0)).toBeVisible();
});
