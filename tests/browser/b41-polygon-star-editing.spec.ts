import { test, expect, type Page } from '@playwright/test';
import { boot, tool } from './helpers';

interface ShapeNode {
  type: string;
  pointCount: number | null;
  innerRadius: number | null;
  cornerRadius: number | null;
}

/** The selected node's shape fields, read from the store. */
async function selected(page: Page): Promise<ShapeNode> {
  return page.evaluate(() => {
    const store = window.__pigmaStore;
    if (!store) throw new Error('window.__pigmaStore is not exposed');
    const state = store.getState() as unknown as { selection: string[]; file: { document: { children: Array<{ children: ShapeNode[] }> } } };
    const id = state.selection[0];
    if (!id) throw new Error('nothing is selected');
    const all = state.file.document.children[0]!.children as Array<ShapeNode & { id: string }>;
    const node = all.find((n) => n.id === id);
    if (!node) throw new Error(`selected node ${id} not found`);
    return {
      type: node.type,
      pointCount: node.pointCount ?? null,
      innerRadius: node.innerRadius ?? null,
      cornerRadius: node.cornerRadius ?? null,
    };
  });
}

/** The rendered geometry of the selected node, so a change is visible not just stored. */
async function rendered(page: Page): Promise<string> {
  return page.evaluate(() => {
    const svg = document.querySelector('.canvas__svg');
    return svg ? svg.innerHTML.length.toString() + ':' + svg.innerHTML.slice(0, 400) : '';
  });
}

async function draw(page: Page, name: string, dx = 140, dy = 110): Promise<void> {
  await tool(page, name).click();
  const box = (await page.locator('.canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx - dx / 2, cy - dy / 2);
  await page.mouse.down();
  await page.mouse.move(cx + dx / 2, cy + dy / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(400);
}

async function setField(page: Page, label: string, value: string): Promise<void> {
  const field = page.locator(`.app__right input[aria-label="${label}"]`);
  await field.fill(value);
  await field.press('Enter');
  await page.waitForTimeout(350);
}

test('B41a the polygon Sides control changes the point count and the geometry', async ({ page }) => {
  await boot(page, { blank: true });
  await draw(page, 'Polygon');

  expect((await selected(page)).pointCount).toBe(3);
  const before = await rendered(page);

  await setField(page, 'Sides', '6');
  const after = await selected(page);
  expect(after.pointCount, 'Sides did not change the point count').toBe(6);
  expect(after.type).toBe('POLYGON');
  expect(await rendered(page), 'the hexagon renders identically to the triangle').not.toBe(before);
});

test('B41b the star Points and Inner radius controls change the model and the geometry', async ({ page }) => {
  await boot(page, { blank: true });
  await draw(page, 'Star');

  const start = await selected(page);
  expect(start.type).toBe('STAR');
  expect(start.pointCount).toBe(5);
  const beforePoints = await rendered(page);

  await setField(page, 'Points', '8');
  expect((await selected(page)).pointCount).toBe(8);
  expect(await rendered(page), 'adding points changed nothing on screen').not.toBe(beforePoints);

  const beforeInner = await rendered(page);
  await setField(page, 'Inner radius', '80');
  const withInner = await selected(page);
  expect(withInner.innerRadius, 'the inner radius was not stored').toBeCloseTo(0.8, 2);
  expect(await rendered(page), 'the inner radius changed nothing on screen').not.toBe(beforeInner);

  // Bounds are clamped, so an out-of-range value cannot corrupt the shape.
  await setField(page, 'Inner radius', '500');
  const clamped = await selected(page);
  expect(clamped.innerRadius).toBeLessThanOrEqual(1);
  expect(clamped.innerRadius).toBeGreaterThan(0);
});

test('B41c the corner Radius control rounds rectangles, polygons and stars alike', async ({ page }) => {
  await boot(page, { blank: true });

  // The rectangle is the control: the same field demonstrably rounds corners.
  await draw(page, 'Rectangle', 120, 90);
  await setField(page, 'Radius', '12');
  expect((await selected(page)).cornerRadius).toBe(12);
  expect(await rendered(page), 'a rectangle did not round at radius 12').toContain('A 12 12');

  // The shape just drawn is the last one in the SVG, so its own path can be
  // read without guessing at positions.
  const lastPath = () =>
    page.evaluate(() => {
      const paths = [...document.querySelectorAll('.canvas__svg path')];
      return paths.length > 0 ? paths[paths.length - 1]!.getAttribute('d') ?? '' : '';
    });

  for (const shape of ['Polygon', 'Star']) {
    await draw(page, shape, 90, 70);
    const before = await lastPath();
    expect(before, `${shape} was already rounded before the control was used`).not.toContain('A ');

    await setField(page, 'Radius', '12');
    expect((await selected(page)).cornerRadius, `${shape} ignored the corner Radius control`).toBe(12);

    // FIXED (was: the rendered path was byte-identical to radius 0). Every corner
    // is now cut back and closed with an arc, so the geometry changes and the
    // arcs are there to see.
    const after = await lastPath();
    expect(after, `${shape} still renders the same sharp geometry at radius 12`).not.toBe(before);
    expect(after, `${shape} has no rounded corner`).toContain('A ');
    expect(await rendered(page), 'the canvas did not re-render at all').not.toBe('');
  }
});
test('B41d Inner radius is offered for stars only, and displayed for polygons it is absent', async ({ page }) => {
  await boot(page, { blank: true });

  await draw(page, 'Star', 90, 70);
  await expect(page.locator('.app__right input[aria-label="Inner radius"]')).toHaveCount(1);
  await expect(page.locator('.app__right input[aria-label="Points"]')).toHaveCount(1);

  // Select the star and draw a polygon; the polygon exposes Sides, not Points,
  // and has no inner radius.
  await draw(page, 'Polygon', 90, 70);
  await expect(page.locator('.app__right input[aria-label="Sides"]')).toHaveCount(1);
  await expect(page.locator('.app__right input[aria-label="Points"]')).toHaveCount(0);
  await expect(page.locator('.app__right input[aria-label="Inner radius"]')).toHaveCount(0);
});
