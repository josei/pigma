/**
 * Corner rotation zones: a press just outside a selected layer's corner starts a rotation, as the top-centre handle does.
 * A press there that does not move selects the layer behind the zone. The layer is 120 x 90 at 100 percent zoom, so the
 * top-left zone's centre is 13 px outside the corner, on the diagonal.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, nextPaint } from './helpers';

/** The selected layer's rotation in degrees, read from its transform. */
async function rotation(page: Page) {
  return page.evaluate(() => {
    const node = window.__pigmaStore!.getState().file.document.children[0]!.children.at(-1) as unknown as {
      transform: { a: number; b: number };
    };
    return (Math.atan2(node.transform.b, node.transform.a) * 180) / Math.PI;
  });
}

/** Screen centre of the canvas, which is the centre of a layer drawn at offset 0. */
async function canvasCentre(page: Page) {
  const box = (await page.locator('.canvas').boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('B167a a drag from the top-left corner zone rotates the layer to the pointer', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 120, 90, 0, 0);
  const { x: cx, y: cy } = await canvasCentre(page);
  // From the top-left corner zone, to a point straight above the centre: the start angle is -141.5 degrees, the end is -90.
  await page.mouse.move(cx - 60 - 13, cy - 45 - 13);
  await page.mouse.down();
  await page.mouse.move(cx, cy - 200, { steps: 10 });
  await page.mouse.up();
  await nextPaint(page);
  expect(Math.abs((await rotation(page)) - 51.5)).toBeLessThan(2);
});

test('B167b a press on a corner zone that does not move selects the layer behind it', async ({ page }) => {
  await boot(page, { blank: true });
  // The big layer is drawn first, so it sits behind the small one. The small one is selected, and its top-left zone lies on
  // the big one.
  await drawShape(page, 'Rectangle', 300, 250, 0, 0);
  await drawShape(page, 'Rectangle', 120, 90, 0, 0);
  const { x: cx, y: cy } = await canvasCentre(page);
  // The press point must be on the zone itself: a plain click inside the big layer would select it too.
  const zone = { x: cx - 60 - 13, y: cy - 45 - 13 };
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.getAttribute('fill') ?? null, zone);
  expect(hit, 'the corner zone is not under the press point').toBe('transparent');
  await page.mouse.move(zone.x, zone.y);
  await page.mouse.down();
  await page.mouse.up();
  await nextPaint(page);
  const selected = await page.evaluate(() => {
    const store = window.__pigmaStore!.getState();
    const children = store.file.document.children[0]!.children as unknown as Array<{ id: string }>;
    return { selection: store.selection, big: children[0]!.id };
  });
  expect(selected.selection).toEqual([selected.big]);
});
