/**
 * Reordering a grid track from the properties panel: the Move up and Move down buttons on a
 * column track swap it with its neighbour, the sizes travel with it, and the edge buttons are off.
 * The model operation is unit-tested (gridTracks.test.ts); this drives the live UI.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, tool, field } from './helpers';

/** A frame with `count` small rectangles inside it, the frame selected (as in B57). */
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
  await drag(-150, -100, 150, 100);
  for (let i = 0; i < count; i += 1) {
    await tool(page, 'Rectangle').click();
    await drag(-120 + i * 25, -60, -100 + i * 25, -40);
  }
  await page.locator('.layer-row', { hasText: 'Frame' }).first().click();
  await expect(page.locator('[role="group"][aria-label="Direction"]')).toBeVisible();
}

async function columns(page: Page): Promise<Array<{ type: string; value: number }>> {
  return page.evaluate(() => {
    const store = window.__pigmaStore;
    if (!store) throw new Error('window.__pigmaStore is not exposed');
    const pageNode = (store.getState() as unknown as {
      file: { document: { children: Array<{ children: Array<Record<string, unknown>> }> } };
    }).file.document.children[0]!;
    const frame = (pageNode.children as Array<Record<string, unknown>>).find((n) => n.type === 'FRAME')!;
    return ((frame.autoLayout as { gridColumns?: Array<{ type: string; value: number }> }).gridColumns ?? []) as Array<{
      type: string;
      value: number;
    }>;
  });
}

test('B109a Move down swaps a column track with its neighbour, and the size travels with it', async ({ page }) => {
  await frameWithChildren(page, 2);
  await page.locator('[role="group"][aria-label="Direction"] button', { hasText: 'Grid' }).click();
  await page.waitForTimeout(350);
  expect((await columns(page)).map((c) => c.type)).toEqual(['FLEX', 'FLEX']);

  // Make column 1 a fixed 50px track, so the swap is visible in the sizes.
  const sizing = page.locator('[aria-label="Columns track 1 sizing"]');
  if ((await sizing.textContent())?.trim() === 'fr') await sizing.click();
  const input = field(page, 'Columns track 1');
  await input.fill('50');
  await input.press('Enter');
  await page.waitForTimeout(350);
  expect(await columns(page)).toEqual([
    { type: 'FIXED', value: 50 },
    { type: 'FLEX', value: 1 },
  ]);

  await expect(page.getByRole('button', { name: 'Move column track 1 up' }), 'the first track can move up').toBeDisabled();
  await page.getByRole('button', { name: 'Move column track 1 down' }).click();
  await page.waitForTimeout(350);
  expect(await columns(page), 'the track did not move with its size').toEqual([
    { type: 'FLEX', value: 1 },
    { type: 'FIXED', value: 50 },
  ]);
  await expect(page.getByRole('button', { name: 'Move column track 2 down' }), 'the last track can move down').toBeDisabled();
});
