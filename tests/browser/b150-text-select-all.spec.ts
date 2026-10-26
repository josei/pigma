/**
 * Double-clicking a text layer selects all of its text (Sketch's Dublin release says so), so typing replaces it. Before this
 * the caret went to the end, and a double-click could only append. This drives the live text editor.
 */
import { test, expect } from '@playwright/test';
import { boot, clickCanvas, nextPaint, tool } from './helpers';

test('B150a double-clicking a text layer selects all of its text, and typing replaces it', async ({ page }) => {
  await boot(page, { blank: true });
  await tool(page, 'Text').click();
  await clickCanvas(page, 0, 0);
  await nextPaint(page);
  await page.keyboard.type('Hello');
  await page.keyboard.press('Escape');
  await nextPaint(page);

  await clickCanvas(page, 0, 0);
  await page.mouse.dblclick(
    (await page.locator('.canvas').boundingBox())!.x + (await page.locator('.canvas').boundingBox())!.width / 2,
    (await page.locator('.canvas').boundingBox())!.y + (await page.locator('.canvas').boundingBox())!.height / 2,
  );
  await nextPaint(page);
  const editor = page.locator('.text-editor');
  await expect(editor).toBeVisible();
  const selection = await editor.evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd, el.value.length]);
  expect(selection).toEqual([0, 5, 5]);

  await page.keyboard.type('Bye');
  await page.keyboard.press('Escape');
  await nextPaint(page);
  const text = await page.evaluate(() => {
    const kids = window.__pigmaStore!.getState().file.document.children[0]!.children as Array<{ type: string; characters?: string }>;
    return kids.find((node) => node.type === 'TEXT')!.characters;
  });
  expect(text).toBe('Bye');
});
