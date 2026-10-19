import { test, expect } from '@playwright/test';
import { boot, drawShape, tool } from './helpers';

/** Alt+drag duplicates the selection and moves the copy; the original stays where it was. */
test('B95a Alt+drag leaves the original in place and moves a copy', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 80, 80, 0, 0);
  await tool(page, 'Move').click();
  const rects = () => page.evaluate(() => (window.__pigmaStore!.getState().file.document.children[0]!.children as any[]).map((n) => ({ x: n.transform.tx, y: n.transform.ty })));
  const before = await rects();
  expect(before).toHaveLength(1);

  const box = (await page.locator('.canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.keyboard.down('Alt');
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 100, cy, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await page.waitForTimeout(250);

  const after = await rects();
  expect(after, 'Alt+drag did not create a copy').toHaveLength(2);
  const original = after.find((r) => Math.abs(r.x - before[0]!.x) < 1 && Math.abs(r.y - before[0]!.y) < 1);
  expect(original, 'the original moved instead of staying in place').toBeTruthy();
  const copy = after.find((r) => r !== original);
  expect(copy!.x, 'the copy did not move with the drag').toBeGreaterThan(before[0]!.x + 50);
});
