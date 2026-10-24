/**
 * The text section for a selection of several text layers: when the layers' sizes differ the Size field is empty, shows a
 * dash and says "Mixed"; typing sets every selected text layer; an arrow step moves each layer from its own size, so the
 * layers keep their difference. The comparison is the isMixedValue check the other fields use; this drives the live panel.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, clickCanvas, field, nextPaint, tool } from './helpers';

/** A text layer at a horizontal offset from the centre, with its size set when one is given. */
async function textLayer(page: Page, dx: number, size?: number) {
  await tool(page, 'Text').click();
  await clickCanvas(page, dx, 0);
  await nextPaint(page);
  if (await page.locator('.text-editor').count()) {
    await page.keyboard.type('Hello');
    await page.keyboard.press('Escape');
  }
  await nextPaint(page);
  if (size) {
    await field(page, 'Size').fill(String(size));
    await field(page, 'Size').press('Enter');
    await nextPaint(page);
  }
}

/** Two text layers, sizes 12 and 30, with both selected. */
async function twoSizes(page: Page) {
  await boot(page, { blank: true });
  await textLayer(page, -160, 12);
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

test('B139a text layers with different sizes show an empty Size field, a dash, and the Mixed tooltip', async ({ page }) => {
  await twoSizes(page);
  const size = field(page, 'Size');
  await expect(size).toHaveValue('');
  await expect(size).toHaveAttribute('placeholder', '—');
  await expect(size).toHaveAttribute('title', 'Mixed');
});

test('B139b typing a size sets every selected text layer, so the field shows it with no Mixed state', async ({ page }) => {
  await twoSizes(page);
  const size = field(page, 'Size');
  await size.fill('18');
  await size.press('Enter');
  await nextPaint(page);
  await expect(size).toHaveValue('18');
  await expect(size).not.toHaveAttribute('title', 'Mixed');
  expect(await textSizes(page)).toEqual([18, 18]);
});

test('B139c an arrow step on a mixed size moves each layer from its own size: 13 and 31, not one shared value', async ({ page }) => {
  await twoSizes(page);
  await field(page, 'Size').focus();
  await page.keyboard.press('ArrowUp');
  await nextPaint(page);
  expect((await textSizes(page)).sort((a, b) => a - b)).toEqual([13, 31]);
  await expect(field(page, 'Size'), 'the step made the layers equal, or the field lost its mixed state').toHaveAttribute('placeholder', '—');
});
