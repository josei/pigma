import { test, expect, type Page } from '@playwright/test';
import { boot, tool, field } from './helpers';

/**
 * Grid auto layout on the LIVE canvas.
 *
 * The editor's grid tests are unit geometry; this drives the real UI. A 300-wide
 * frame on the default grid is two FLEX columns with 16px padding and a 12px gap,
 * so the cell maths is exact and every number below is asserted, not approximated.
 */

const FRAME_W = 300;
const FRAME_H = 200;
const PAD = 16;
const GAP = 12;
/** (300 - 16*2 - 12) / 2 */
const COL_W = (FRAME_W - PAD * 2 - GAP) / 2;

/** A frame with `count` rectangles inside it, the frame selected. */
async function frameWithChildren(page: Page, count: number): Promise<void> {
  await boot(page, { blank: true });
  const box = (await page.locator('.canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const drag = async (x1: number, y1: number, x2: number, y2: number) => {
    await page.mouse.move(cx + x1, cy + y1);
    await page.mouse.down();
    await page.mouse.move(cx + x2, cy + y2, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(250);
  };

  await tool(page, 'Frame').click();
  await drag(-FRAME_W / 2, -FRAME_H / 2, FRAME_W / 2, FRAME_H / 2);
  for (let i = 0; i < count; i += 1) {
    await tool(page, 'Rectangle').click();
    // Small rects, all inside the frame, so they parent into it.
    await drag(-140 + i * 25, -90, -120 + i * 25, -70);
  }

  // Children are selected last; select the frame itself through the layers tree.
  await page.locator('.layer-row', { hasText: 'Frame' }).first().click();
  await page.waitForTimeout(300);
  await expect(page.locator('[role="group"][aria-label="Direction"]')).toBeVisible();
}

/** The frame's own grid fields and its children's placed geometry. */
async function gridState(page: Page) {
  return page.evaluate(() => {
    const store = window.__pigmaStore;
    if (!store) throw new Error('window.__pigmaStore is not exposed');
    const pageNode = (store.getState() as unknown as {
      file: { document: { children: Array<{ children: Array<Record<string, unknown>> }> } };
    }).file.document.children[0]!;
    const frame = (pageNode.children as Array<Record<string, unknown>>).find((n) => n.type === 'FRAME')!;
    const layout = frame.autoLayout as Record<string, unknown>;
    const kids = ((frame.children ?? []) as Array<{ transform: { tx: number; ty: number }; width: number }>).map((c) => ({
      x: Math.round(c.transform.tx),
      y: Math.round(c.transform.ty),
      w: Math.round(c.width),
    }));
    return {
      mode: layout.layoutMode as string,
      columns: (layout.gridColumns ?? []) as Array<{ type: string; value: number }>,
      columnGap: layout.gridColumnGap as number,
      guides: ((frame.layoutGrids ?? []) as unknown[]).length,
      width: Math.round(frame.width as number),
      kids,
    };
  });
}

async function setDirection(page: Page, label: string): Promise<void> {
  await page.locator('[role="group"][aria-label="Direction"] button', { hasText: label }).click();
  await page.waitForTimeout(350);
}

/** Toggle a column track between fraction and pixels, and set its value. */
async function setColumnTrack(page: Page, index: number, value: number): Promise<void> {
  const sizing = page.locator(`[aria-label="Columns track ${index} sizing"]`);
  // The button reads 'fr' for a fraction and 'px' for a fixed track.
  if ((await sizing.textContent())?.trim() === 'fr') await sizing.click();
  const input = field(page, `Columns track ${index}`);
  await input.fill(String(value));
  await input.press('Enter');
  await page.waitForTimeout(350);
}

test('B57a switching a frame to Grid places children in cells, wrapping the overflow', async ({ page }) => {
  await frameWithChildren(page, 3);
  const before = await gridState(page);
  expect(before.mode, 'the frame did not start on a row/column flow').not.toBe('GRID');

  await setDirection(page, 'Grid');
  const after = await gridState(page);

  expect(after.mode, 'the Direction control did not switch the frame to Grid').toBe('GRID');
  // Two FLEX columns, as the default grid declares.
  expect(after.columns.map((c) => c.type)).toEqual(['FLEX', 'FLEX']);
  expect(after.columnGap).toBe(GAP);

  // Cell 1 and 2 on the first row, the third wrapping to a second row.
  expect(after.kids.map((k) => k.x), `unexpected xs: ${JSON.stringify(after.kids)}`).toEqual([
    PAD,
    PAD + COL_W + GAP,
    PAD,
  ]);
  expect(after.kids[0]!.y, 'the first two children are not on the same row').toBe(after.kids[1]!.y);
  expect(after.kids[2]!.y, 'the third child did not wrap to a second row').toBeGreaterThan(after.kids[0]!.y);
  expect(after.kids.map((k) => k.w), 'the children do not fill their cells').toEqual([COL_W, COL_W, COL_W]);
});

test('B57b a column switched to a FIXED size takes its pixels and the rest reflows', async ({ page }) => {
  await frameWithChildren(page, 3);
  await setDirection(page, 'Grid');

  await setColumnTrack(page, 1, 1);
  const after = await gridState(page);

  expect(after.columns[0], 'the first column is not fixed at 1px').toEqual({ type: 'FIXED', value: 1 });
  // The fixed column takes 1px; the fractional column takes everything left.
  const flex = FRAME_W - PAD * 2 - GAP - 1;
  expect(after.kids.map((k) => k.w), `unexpected widths: ${JSON.stringify(after.kids)}`).toEqual([1, flex, 1]);
  // And the second cell moved right to sit after the fixed column plus the gap.
  expect(after.kids[1]!.x).toBe(PAD + 1 + GAP);
});

test('B57c resizing the frame resizes the fractional track', async ({ page }) => {
  await frameWithChildren(page, 3);
  await setDirection(page, 'Grid');
  const before = await gridState(page);
  expect(before.kids[1]!.x).toBe(PAD + COL_W + GAP);

  // A wider frame: the FLEX columns share the extra space.
  const w = field(page, 'W');
  await w.fill(String(FRAME_W + 100));
  await w.press('Enter');
  await page.waitForTimeout(400);

  const after = await gridState(page);
  expect(after.width, 'the frame did not resize').toBe(FRAME_W + 100);
  const grown = (FRAME_W + 100 - PAD * 2 - GAP) / 2;
  expect(after.kids[0]!.w, 'the fractional track did not grow with the frame').toBe(grown);
  expect(after.kids[1]!.x, 'the second cell did not move with the track').toBe(PAD + grown + GAP);
  expect(after.kids[0]!.w, 'the track width did not change at all').not.toBe(before.kids[0]!.w);
});

test('B57d the track editor is a DIFFERENT control from the layout guides', async ({ page }) => {
  await frameWithChildren(page, 2);
  await setDirection(page, 'Grid');

  const tracks = page.locator('[data-testid="grid-tracks"]');
  await expect(tracks, 'the track editor is missing on a grid frame').toHaveCount(1);

  // The layout GUIDES are a separate control with their own labels, and adding
  // one must NOT be confused with the grid's tracks.
  const addCols = page.locator('[aria-label="Add COLUMNS grid"]');
  await expect(addCols, 'the layout-guide controls are gone').toBeVisible();
  for (const guide of ['Add COLUMNS grid', 'Add ROWS grid', 'Add GRID grid']) {
    await expect(page.locator(`[aria-label="${guide}"]`)).toBeVisible();
  }

  const beforeGuides = await gridState(page);
  await addCols.click();
  await page.waitForTimeout(350);
  const afterGuides = await gridState(page);

  // A guide is not an auto-layout track: the layout mode and the children's
  // placement are untouched, only the guide list grew.
  expect(afterGuides.guides, 'adding a layout guide did not register').toBe(beforeGuides.guides + 1);
  expect(afterGuides.mode, 'adding a layout guide changed the grid layout mode').toBe('GRID');
  expect(afterGuides.kids, 'adding a layout guide moved the children').toEqual(beforeGuides.kids);

  // And the reverse: the track editor disappears when the direction leaves Grid,
  // while the guides stay exactly where they are.
  await setDirection(page, 'Row');
  await expect(tracks, 'the track editor survived leaving the grid direction').toHaveCount(0);
  await expect(page.locator('[aria-label="Add COLUMNS grid"]'), 'the guides went away with the tracks').toBeVisible();
  const after = await gridState(page);
  expect(after.mode).toBe('HORIZONTAL');
  expect(after.guides, 'the guide list changed when the direction did').toBe(afterGuides.guides);
});
