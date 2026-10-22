/**
 * Linking selected text in the editor (Figma: Shift+Cmd+U): select characters while editing a text layer, press
 * Ctrl/Cmd+Shift+U, enter a URL, and the selected characters are drawn as a link. The Text section lists the link and
 * removes it. The model is unit-tested (textRanges.test.ts); this drives the editor and the panel.
 */
import { test, expect } from '@playwright/test';
import { boot, tool, canvasBox } from './helpers';

test('B121a select text in the editor, press Ctrl+Shift+U, enter a URL, and the selection is a link', async ({ page }) => {
  await boot(page, { blank: true });
  await tool(page, 'Text').click();
  const box = await canvasBox(page);
  await page.mouse.click(box.x + 280, box.y + 300);
  await page.keyboard.type('Read the docs');
  await page.keyboard.press('Escape');

  // Edit the layer again and select "docs" (the last four characters, from the caret at the end).
  await page.mouse.dblclick(box.x + 300, box.y + 308);
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Control+Shift+U');

  await expect(page.getByRole('dialog', { name: 'Link selected text' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Link URL' }).fill('https://docs.example');
  await page.keyboard.press('Enter');

  await expect(page.locator('.canvas__svg tspan[fill="#0070c4"]')).toHaveText('docs');
  await expect(page.getByRole('dialog', { name: 'Link selected text' })).toHaveCount(0);
});

test('B121b the Text section lists a link and its Remove button takes it away', async ({ page }) => {
  await boot(page, { blank: true });
  await tool(page, 'Text').click();
  const box = await canvasBox(page);
  await page.mouse.click(box.x + 280, box.y + 300);
  await page.keyboard.type('Read the docs');
  await page.keyboard.press('Escape');
  const id = await page.evaluate(() => window.__pigmaStore!.getState().file.document.children[0]!.children[0]!.id as string);
  await page.evaluate((nodeId) => window.__pigmaStore!.getState().setTextLink(nodeId, 9, 13, 'https://docs.example'), id);

  await page.locator('.layer-row', { hasText: 'Read the docs' }).first().click();
  await expect(page.getByText('https://docs.example')).toBeVisible();
  await page.getByRole('button', { name: 'Remove link on docs' }).click();
  await expect(page.locator('.canvas__svg tspan[fill="#0070c4"]')).toHaveCount(0);
});
