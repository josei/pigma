/**
 * A link on part of a text layer is drawn: the linked characters are in the link colour and underlined, and the rest
 * of the text is not. Clearing the link removes it. The range model and the line offsets are unit-tested
 * (textRanges.test.ts, textLayoutSources.test.ts); this drives the rendered SVG. The UI to add a link comes later, so
 * the link is set through the store action.
 */
import { test, expect } from '@playwright/test';
import { boot, tool, canvasBox } from './helpers';

test('B120a a link on part of a text layer is drawn in the link colour, underlined, and only on that part', async ({ page }) => {
  await boot(page, { blank: true });
  await tool(page, 'Text').click();
  const box = await canvasBox(page);
  await page.mouse.click(box.x + 280, box.y + 300);
  await page.keyboard.type('Read the docs');
  await page.keyboard.press('Escape');

  const id = await page.evaluate(() => window.__pigmaStore!.getState().file.document.children[0]!.children[0]!.id as string);
  await page.evaluate((nodeId) => window.__pigmaStore!.getState().setTextLink(nodeId, 9, 13, 'https://docs.example'), id);

  const linked = page.locator('.canvas__svg tspan[fill="#0070c4"]');
  await expect(linked).toHaveCount(1);
  await expect(linked).toHaveText('docs');
  await expect(linked).toHaveAttribute('style', /underline/);
});

test('B120b clearing the link removes the link colour', async ({ page }) => {
  await boot(page, { blank: true });
  await tool(page, 'Text').click();
  const box = await canvasBox(page);
  await page.mouse.click(box.x + 280, box.y + 300);
  await page.keyboard.type('Read the docs');
  await page.keyboard.press('Escape');
  const id = await page.evaluate(() => window.__pigmaStore!.getState().file.document.children[0]!.children[0]!.id as string);
  await page.evaluate((nodeId) => window.__pigmaStore!.getState().setTextLink(nodeId, 9, 13, 'https://docs.example'), id);
  await expect(page.locator('.canvas__svg tspan[fill="#0070c4"]')).toHaveCount(1);

  await page.evaluate((nodeId) => window.__pigmaStore!.getState().setTextLink(nodeId, 9, 13, null), id);
  await expect(page.locator('.canvas__svg tspan[fill="#0070c4"]')).toHaveCount(0);
});
