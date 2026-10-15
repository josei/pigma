import { test, expect } from '@playwright/test';
import { boot, drawShape, tool } from './helpers';

/** Figma turns a frame into a component directly, with Ctrl/Cmd+Alt+K. */
test('B67a Ctrl+Alt+K turns an empty frame into a component listed in Assets', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Frame', 220, 160);
  await tool(page, 'Move').click();
  await page.keyboard.press('Control+Alt+k');
  const kind = await page.evaluate(() => window.__pigmaStore!.getState().file.document.children[0]!.children[0]!.type);
  expect(kind, 'a frame did not become a component').toBe('COMPONENT');
  await page.locator('.rail__button[aria-label="Assets"]').click();
  await expect(page.locator('.app__left').getByText('Frame 1').first()).toBeVisible();
});

test('B67b a frame with children keeps them inside the new component', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Frame', 300, 220);
  await drawShape(page, 'Rectangle', 80, 60, 40, 40);
  await tool(page, 'Move').click();
  // The rectangle sits inside the frame; select the frame itself.
  await page.evaluate(() => {
    const s = window.__pigmaStore!.getState();
    s.select([s.file.document.children[0]!.children[0]!.id]);
  });
  await page.keyboard.press('Control+Alt+k');
  const counts = await page.evaluate(() => {
    const top = window.__pigmaStore!.getState().file.document.children[0]!.children as any[];
    const comp = top.find((c) => c.type === 'COMPONENT');
    return { top: top.map((c) => c.type), inside: comp ? comp.children[0].children.length : -1 };
  });
  // The rectangle was drawn inside the frame, so the component is the only top-level layer.
  expect(counts.top).toEqual(['COMPONENT']);
  expect(counts.inside, 'the frame lost its child').toBe(1);
});

test('B67c several layers still refuse, with a reason', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 120, 100);
  await drawShape(page, 'Ellipse', 100, 80, 300, 0);
  await tool(page, 'Move').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+Alt+k');
  await expect(page.getByText(/Select a single layer/i)).toBeVisible();
  const types = await page.evaluate(() => window.__pigmaStore!.getState().file.document.children[0]!.children.map((c: any) => c.type));
  expect(types).not.toContain('COMPONENT');
});
