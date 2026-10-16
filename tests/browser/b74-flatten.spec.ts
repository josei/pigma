import { test, expect } from '@playwright/test';
import { boot, drawShape, tool } from './helpers';

/** Flatten (Ctrl/Cmd+E) merges overlapping shapes into one path layer. */
test('B74a Ctrl+E flattens two overlapping shapes into one layer', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 160, 120);
  await drawShape(page, 'Ellipse', 120, 120, 120, 40);
  await tool(page, 'Move').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+e');
  const top = await page.evaluate(() =>
    window.__pigmaStore!.getState().file.document.children[0]!.children.map((c: any) => c.type),
  );
  expect(top, 'the shapes were not merged into one layer').toHaveLength(1);
  expect(top[0]).toBe('BOOLEAN_OPERATION');
});

test('B74b flatten refuses a single layer, with a reason', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 160, 120);
  await tool(page, 'Move').click();
  await page.keyboard.press('Control+e');
  await expect(page.getByText(/Select two or more shapes, or a group/i)).toBeVisible();
});

test('B74c Ctrl+E flattens a group of shapes into one path, and one undo brings the group back', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 160, 120);
  await drawShape(page, 'Ellipse', 120, 120, 120, 40);
  await tool(page, 'Move').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+g');
  const grouped = () => page.evaluate(() => window.__pigmaStore!.getState().file.document.children[0]!.children.map((c: any) => c.type));
  expect(await grouped()).toEqual(['GROUP']);
  await page.keyboard.press('Control+e');
  expect(await grouped(), 'the group did not flatten into one layer').toEqual(['BOOLEAN_OPERATION']);
  await page.keyboard.press('Control+z');
  expect(await grouped(), 'one undo did not restore the group').toEqual(['GROUP']);
});
