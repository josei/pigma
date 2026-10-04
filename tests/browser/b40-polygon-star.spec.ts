import { test, expect, type Page } from '@playwright/test';
import { boot, tool, toDoc } from './helpers';

interface NodeInfo {
  type: string;
  width: number;
  height: number;
  points: number | null;
}

/** Top-level nodes of the current page. */
async function nodes(page: Page): Promise<NodeInfo[]> {
  return page.evaluate(() => {
    const store = window.__pigmaStore;
    if (!store) throw new Error('window.__pigmaStore is not exposed');
    const pageNode = store.getState().file.document.children[0] as {
      children: Array<{ type: string; width: number; height: number; pointCount?: number }>;
    };
    return pageNode.children.map((n) => ({
      type: n.type,
      width: n.width,
      height: n.height,
      points: n.pointCount ?? null,
    }));
  });
}

async function dragOnCanvas(page: Page, dx: number, dy: number): Promise<void> {
  const box = (await page.locator('.canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx - dx / 2, cy - dy / 2);
  await page.mouse.down();
  await page.mouse.move(cx + dx / 2, cy + dy / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(450);
}

test('B40a the polygon tool creates a POLYGON with the drawn geometry', async ({ page }) => {
  await boot(page, { blank: true });
  await tool(page, 'Polygon').click();
  await dragOnCanvas(page, 140, 100);

  const created = (await nodes(page)).filter((n) => n.type === 'POLYGON');
  expect(created, 'no POLYGON node was created').toHaveLength(1);

  const zoom = 240 / (await toDoc(page, 240));
  expect(created[0]!.width).toBeCloseTo(140 / zoom, 0);
  expect(created[0]!.height).toBeCloseTo(100 / zoom, 0);
  expect(created[0]!.points, 'a polygon should have 3 points by default').toBe(3);
});

test('B40b the star tool creates a STAR with the drawn geometry', async ({ page }) => {
  await boot(page, { blank: true });
  await tool(page, 'Star').click();
  await dragOnCanvas(page, 140, 100);

  const created = (await nodes(page)).filter((n) => n.type === 'STAR');
  expect(created, 'no STAR node was created').toHaveLength(1);

  const zoom = 240 / (await toDoc(page, 240));
  expect(created[0]!.width).toBeCloseTo(140 / zoom, 0);
  expect(created[0]!.height).toBeCloseTo(100 / zoom, 0);
  expect(created[0]!.points, 'a star should have 5 points by default').toBe(5);
});

test('B40c the layer icons for ellipse, polygon and star are distinct', async ({ page }) => {
  await boot(page, { blank: true });
  for (const [name, dx, dy] of [
    ['Ellipse', 80, 80],
    ['Polygon', 100, 90],
    ['Star', 120, 110],
  ] as Array<[string, number, number]>) {
    await tool(page, name).click();
    await dragOnCanvas(page, dx, dy);
  }

  const icons = await page.evaluate(() =>
    [...document.querySelectorAll('.layer-row')].map((row) => ({
      name: row.querySelector('.layer-row__name')?.textContent?.trim() ?? '',
      // The glyphs are different SVG elements (ellipse is an <ellipse>, star is
      // a <path>), so compare the whole icon markup rather than path `d`.
      glyph: row.querySelector('.layer-row__icon svg')?.innerHTML.trim() ?? '',
    })),
  );
  const byName = (prefix: string) => icons.find((i) => i.name.startsWith(prefix));
  const ellipse = byName('Ellipse');
  const polygon = byName('Polygon');
  const star = byName('Star');

  expect(ellipse?.glyph, 'no ellipse layer row').toBeTruthy();
  expect(polygon?.glyph, 'no polygon layer row').toBeTruthy();
  expect(star?.glyph, 'no star layer row').toBeTruthy();

  // The original defect was that POLYGON and STAR both rendered the ellipse
  // glyph. Three distinct glyphs means three distinct icons.
  const distinct = new Set([ellipse!.glyph, polygon!.glyph, star!.glyph]);
  expect(distinct.size, `icons collapsed to ${distinct.size} glyph(s): ${JSON.stringify(icons)}`).toBe(3);
});

test('B40d Escape cancels the polygon tool without creating a node', async ({ page }) => {
  await boot(page, { blank: true });
  const before = (await nodes(page)).length;

  await tool(page, 'Polygon').click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);

  // Back to the default tool...
  await expect(page.locator('.toolbar__button[aria-label="Move"]')).toHaveAttribute('aria-pressed', 'true');

  // ...and a canvas drag afterwards selects/moves rather than drawing.
  await dragOnCanvas(page, 140, 100);
  const after = await nodes(page);
  expect(after.length, `Escape did not cancel: ${JSON.stringify(after)}`).toBe(before);
  expect(after.filter((n) => n.type === 'POLYGON')).toHaveLength(0);
});
