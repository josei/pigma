import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, tool } from './helpers';

const order = (page: Page) =>
  page.evaluate(() => window.__pigmaStore!.getState().file.document.children[0]!.children.map((c: any) => c.name));

/** Layer order commands act on a selection without reshuffling it. */
test('B79a bringing a whole selection forward or to front keeps its order', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 80, 60, -120, 0);
  await drawShape(page, 'Rectangle', 80, 60, 0, 0);
  await drawShape(page, 'Rectangle', 80, 60, 120, 0);
  await tool(page, 'Move').click();
  const before = await order(page);
  expect(before).toEqual(['Rectangle 1', 'Rectangle 2', 'Rectangle 3']);
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+Shift+]');
  expect(await order(page), 'bring to front reshuffled the selection').toEqual(before);
  await page.keyboard.press('Control+]');
  expect(await order(page), 'bring forward reshuffled the selection').toEqual(before);
});

test('B79b bringing one layer forward moves it past its neighbour', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 80, 60, -120, 0);
  await drawShape(page, 'Rectangle', 80, 60, 0, 0);
  await tool(page, 'Move').click();
  await page.evaluate(() => {
    const s = window.__pigmaStore!.getState();
    s.select([s.file.document.children[0]!.children[0]!.id]);
  });
  await page.keyboard.press('Control+]');
  expect(await order(page)).toEqual(['Rectangle 2', 'Rectangle 1']);
});

/** The bracket keys are matched by key position: with Shift they type } and {, not ] and [. */
test('B79c Ctrl+Shift+] brings a layer to the front on any keyboard layout', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 80, 60, -120, 0);
  await drawShape(page, 'Rectangle', 80, 60, 0, 0);
  await tool(page, 'Move').click();
  await page.evaluate(() => {
    const s = window.__pigmaStore!.getState();
    s.select([s.file.document.children[0]!.children[0]!.id]);
  });
  // A real keyboard reports the shifted key as "}", not "]"; the key position is what counts.
  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  await page.keyboard.press('BracketRight');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
  expect(await order(page)).toEqual(['Rectangle 2', 'Rectangle 1']);
});
