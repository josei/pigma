import { test, expect, type Page } from '@playwright/test';
import { boot, tool, toDoc } from './helpers';

/** Node types in the document, from the store. */
async function nodeTypes(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const store = window.__pigmaStore;
    if (!store) throw new Error('window.__pigmaStore is not exposed');
    const out: string[] = [];
    const walk = (node: { type: string; children?: unknown[] }): void => {
      out.push(node.type);
      for (const child of (node.children ?? []) as Array<{ type: string; children?: unknown[] }>) walk(child);
    };
    walk(store.getState().file.document);
    return out;
  });
}

test('B36a the line tool creates a LINE node with the drawn geometry', async ({ page }) => {
  await boot(page, { blank: true });
  const before = await nodeTypes(page);
  expect(before).not.toContain('LINE');

  await tool(page, 'Line').click();
  const box = (await page.locator('.canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2 - 120, box.y + box.height / 2 - 60);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 60, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);

  const after = await nodeTypes(page);
  expect(after, `no LINE node created; types: ${JSON.stringify(after)}`).toContain('LINE');

  // A LINE stores its LENGTH in `width`, not a bounding box: dragging 240x120
  // gives width = sqrt(240^2 + 120^2) = 268.33, and height is 0 because a line
  // has no thickness. (Measured, not assumed - my first version asserted a
  // bounding box and was wrong.)
  const w = Number(await page.locator('input[aria-label="W"]').inputValue());
  const h = Number(await page.locator('input[aria-label="H"]').inputValue());
  const zoom = 240 / (await toDoc(page, 240)); // toDoc divides by zoom; recover it
  const dragPx = Math.hypot(240, 120);
  const expectedLength = dragPx / zoom;
  expect(
    Math.abs(w - expectedLength) / expectedLength,
    `line width ${w} is not the drag length ${expectedLength.toFixed(1)}`,
  ).toBeLessThan(0.05);
  expect(h, 'a line should have no thickness').toBeCloseTo(0, 1);
});

test('B36b a line renders as a stroked line, not a filled shape', async ({ page }) => {
  await boot(page, { blank: true });
  await tool(page, 'Line').click();
  const box = (await page.locator('.canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2 - 100, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(500);

  const drawn = await page.evaluate(() => {
    const svg = document.querySelector('.canvas__svg');
    return svg ? svg.querySelectorAll('line, path').length : 0;
  });
  expect(drawn, 'the line did not render as line/path geometry').toBeGreaterThan(0);
});
