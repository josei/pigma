/**
 * The text section for a selection that has a text layer which is not first: the section still shows, reads the text
 * layer's values, and a typed size reaches only the text layers, so a rectangle in the selection keeps no text style.
 * This drives the live panel.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, clickCanvas, drawShape, field, nextPaint, tool } from './helpers';

/** A text layer at a horizontal offset from the centre, with its size set. */
async function textLayer(page: Page, dx: number, size: number) {
  await tool(page, 'Text').click();
  await clickCanvas(page, dx, 0);
  await nextPaint(page);
  if (await page.locator('.text-editor').count()) {
    await page.keyboard.type('Hello');
    await page.keyboard.press('Escape');
  }
  await nextPaint(page);
  await field(page, 'Size').fill(String(size));
  await field(page, 'Size').press('Enter');
  await nextPaint(page);
}

/** A rectangle first, then a text layer of size 30, with both selected. */
async function rectangleThenText(page: Page) {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 120, 90, -160, 0);
  await textLayer(page, 160, 30);
  await tool(page, 'Move').click();
  await page.keyboard.press('Control+A');
  await expect(page.getByText('2 layers selected')).toBeVisible();
}

/** The font size of every text layer in the document, in layer order. */
const textSizes = (page: Page) =>
  page.evaluate(() =>
    (window.__pigmaStore!.getState().file.document.children[0]!.children as Array<{ type: string; style?: { fontSize: number } }>)
      .filter((node) => node.type === 'TEXT')
      .map((node) => node.style!.fontSize),
  );

test('B140a a selection whose first layer is a rectangle still shows the text section, with the text layer values', async ({ page }) => {
  await rectangleThenText(page);
  await expect(field(page, 'Size')).toHaveValue('30');
  await expect(field(page, 'Size')).not.toHaveAttribute('title', 'Mixed');
});

test('B140b a typed size reaches the text layer only, and the rectangle keeps no text style', async ({ page }) => {
  await rectangleThenText(page);
  await field(page, 'Size').fill('18');
  await field(page, 'Size').press('Enter');
  await nextPaint(page);
  expect(await textSizes(page)).toEqual([18]);
  const styles = await page.evaluate(() =>
    (window.__pigmaStore!.getState().file.document.children[0]!.children as Array<{ type: string; style?: unknown }>)
      .filter((node) => node.type === 'RECTANGLE')
      .map((node) => node.style),
  );
  expect(styles).toEqual([undefined]);
});
