import { test, expect } from '@playwright/test';
import { boot, drawShape, tool, nextPaint } from './helpers';

/** Cmd/Ctrl+Alt+B detaches the selected instance (Figma's shortcut), keeping its layers. */
test('B93a Ctrl+Alt+B detaches the selected instance and keeps its layers', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 80, 80, 0, 0);
  await tool(page, 'Create component').click();
  await nextPaint(page);
  await page.locator('.rail__button[aria-label="Assets"]').click();
  await page.locator('.app__left .layer-row').first().dblclick();
  await nextPaint(page);
  await page.locator('.rail__button[aria-label="Layers"]').click();

  const instanceId = await page.evaluate(() => (window.__pigmaStore!.getState().file.document.children[0]!.children as any[]).find((n) => n.type === 'INSTANCE').id as string);
  await page.evaluate((id) => window.__pigmaStore!.getState().select([id]), instanceId);
  await page.keyboard.press('Control+Alt+b');
  await nextPaint(page);

  const after = await page.evaluate((id) => {
    const node = (window.__pigmaStore!.getState().file.document.children[0]!.children as any[]).find((n) => n.id === id);
    return { type: node?.type ?? null, kids: (node?.children ?? []).map((c: any) => c.type) };
  }, instanceId);
  expect(after.type, 'the instance was not detached').toBe('FRAME');
  expect(after.kids, 'detaching lost the instance layers').toEqual(['RECTANGLE']);
});

/** Ctrl/Cmd+D duplicates, Ctrl/Cmd+Shift+D duplicates without interactions (B157c), and Ctrl+Alt+Shift+D duplicates nothing. */
test('B93b Ctrl+D duplicates, Ctrl+Shift+D duplicates again, and Ctrl+Alt+Shift+D does not', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 80, 80, 0, 0);
  const count = () => page.evaluate(() => (window.__pigmaStore!.getState().file.document.children[0]!.children as any[]).length);
  expect(await count()).toBe(1);
  await page.keyboard.press('Control+d');
  await nextPaint(page);
  expect(await count(), 'Ctrl+D did not duplicate').toBe(2);
  await page.keyboard.press('Control+Shift+d');
  await nextPaint(page);
  expect(await count(), 'Ctrl+Shift+D did not duplicate').toBe(3);
  await page.keyboard.press('Control+Alt+Shift+d');
  await nextPaint(page);
  expect(await count(), 'Ctrl+Alt+Shift+D duplicated').toBe(3);
});
