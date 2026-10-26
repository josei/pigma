/**
 * Frame guides (Figma's guides on frames): with one frame selected, a guide dragged from a ruler belongs to that frame,
 * is stored in the frame's own coordinates, and is drawn where the frame places it. Deselecting the frame hides it.
 * The model is unit-tested (guides.test.ts); this drives the live canvas and reads the store for the stored offset.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, canvasBox, drawShape } from './helpers';

type Viewport = { x: number; y: number; zoom: number };

async function frameState(page: Page) {
  return page.evaluate(() => {
    const state = window.__pigmaStore!.getState();
    const frame = state.file.document.children[0]!.children[0] as { x?: number; transform: { tx: number; ty: number }; guides?: Array<{ axis: string; offset: number }> };
    return {
      frameX: frame.transform.tx,
      frameY: frame.transform.ty,
      frameGuides: frame.guides ?? [],
      pageGuides: (state.file.document.children[0] as { guides?: unknown[] }).guides ?? [],
      viewport: state.viewport as Viewport,
    };
  });
}

test('B122a a guide dragged from the ruler with a frame selected belongs to the frame, and is drawn in page position', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Frame', 220, 160, -150, -80);
  await page.locator('.layer-row', { hasText: 'Frame 1' }).first().click();

  const box = await canvasBox(page);
  await page.mouse.move(box.x + 300, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 300, { steps: 8 });
  await page.mouse.up();

  const state = await frameState(page);
  expect(state.frameGuides, 'the guide did not go to the selected frame').toHaveLength(1);
  expect(state.pageGuides, 'the guide went to the page instead').toHaveLength(0);
  // The guide is in the frame's coordinates, so its page position is the frame's origin plus that offset.
  const drawnY = Number(await page.locator('[data-testid="guide-line"]').first().getAttribute('y1'));
  const pageY = state.frameY + state.frameGuides[0]!.offset;
  expect(drawnY).toBeCloseTo(state.viewport.y + pageY * state.viewport.zoom, 0);
});

test('B122b a frame guide is hidden when the frame is no longer selected', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Frame', 220, 160, -150, -80);
  await page.locator('.layer-row', { hasText: 'Frame 1' }).first().click();
  const box = await canvasBox(page);
  await page.mouse.move(box.x + 300, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 300, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('[data-testid="guide-line"]')).toHaveCount(1);

  await page.mouse.click(box.x + 40, box.y + 600);
  await expect(page.locator('[data-testid="guide-line"]')).toHaveCount(0);
  expect((await frameState(page)).frameGuides).toHaveLength(1);
});
