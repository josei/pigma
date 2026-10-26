/**
 * Cmd/Ctrl+B over selected text in the editor makes it bold (drawn as a bold tspan) and a second press makes it plain
 * again. Without a selection the key is left alone. The toggle rule is unit-tested (textRanges.test.ts); this drives the
 * editor and the rendered SVG.
 */
import { test, expect } from '@playwright/test';
import { boot, tool, canvasBox } from './helpers';

test('B124a Ctrl/Cmd+B over selected text in the editor makes it bold, and a second press makes it plain', async ({ page }) => {
  await boot(page, { blank: true });
  await tool(page, 'Text').click();
  const box = await canvasBox(page);
  await page.mouse.click(box.x + 280, box.y + 300);
  await page.keyboard.type('Read the docs');
  await page.keyboard.press('Escape');

  await page.mouse.dblclick(box.x + 300, box.y + 308);
  await page.keyboard.press('End');
  for (let step = 0; step < 4; step++) await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Control+b');

  const bold = page.locator('.canvas__svg tspan[font-weight="700"]');
  await expect(bold).toHaveText('docs');

  await page.keyboard.press('Control+b');
  await expect(bold).toHaveCount(0);
});

test('B124b Ctrl/Cmd+B with no selection does not change the text', async ({ page }) => {
  await boot(page, { blank: true });
  await tool(page, 'Text').click();
  const box = await canvasBox(page);
  await page.mouse.click(box.x + 280, box.y + 300);
  await page.keyboard.type('Read the docs');
  await page.keyboard.press('Escape');

  await page.mouse.dblclick(box.x + 300, box.y + 308);
  await page.keyboard.press('End');
  await page.keyboard.press('Control+b');

  await expect(page.locator('.canvas__svg tspan[font-weight="700"]')).toHaveCount(0);
});
