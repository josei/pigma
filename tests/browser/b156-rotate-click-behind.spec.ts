/**
 * A press on a selected layer's rotate handle that does not move selects the layer behind the handle, and does not rotate the
 * selected layer (Sketch's Dublin release: clicking a hovered corner's rotation handle selects the layer behind it). A drag from
 * the handle still rotates the selected layer. The handle is Pigma's top-centre circle, not a corner, so the layer behind it is
 * the one under the handle's point.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, docToScreen, drawShape, nextPaint } from './helpers';

/** A large rectangle, then a small one drawn over its centre, so the small one is on top and selected. */
async function bigAndSmall(page: Page) {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 400, 300, 0, 0);
  await drawShape(page, 'Rectangle', 100, 80, 0, 0);
  await nextPaint(page);
}

/** The small layer and the big one, from the store, with the small layer's handle position in document units. */
const layers = (page: Page) =>
  page.evaluate(() => {
    const kids = window.__pigmaStore!.getState().file.document.children[0]!.children as Array<{ id: string; transform: { tx: number; ty: number; b: number }; width: number; height: number }>;
    const [big, small] = kids;
    return {
      bigId: big!.id,
      smallId: small!.id,
      smallRotation: small!.transform.b,
      handleX: small!.transform.tx + small!.width / 2,
      handleY: small!.transform.ty - 22,
    };
  });

test('B156a a press on the rotate handle that does not move selects the layer behind it, without rotating', async ({ page }) => {
  await bigAndSmall(page);
  const before = await layers(page);
  const handle = await docToScreen(page, before.handleX, before.handleY);
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.up();
  await nextPaint(page);

  const after = await layers(page);
  const selected = await page.evaluate(() => window.__pigmaStore!.getState().selection);
  expect(selected).toEqual([before.bigId]);
  expect(after.smallRotation).toBeCloseTo(0, 6);
});

test('B156b a drag from the rotate handle still rotates the selected layer, and keeps it selected', async ({ page }) => {
  await bigAndSmall(page);
  const before = await layers(page);
  const from = await docToScreen(page, before.handleX, before.handleY);
  const to = await docToScreen(page, before.handleX + 60, before.handleY - 20);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await nextPaint(page);

  const after = await layers(page);
  const selected = await page.evaluate(() => window.__pigmaStore!.getState().selection);
  expect(selected).toEqual([before.smallId]);
  expect(Math.abs(after.smallRotation)).toBeGreaterThan(0.01);
});
