/**
 * Bold on part of a text layer is drawn: the bold characters are a tspan at their weight, and the rest of the text is
 * not. The layer is measured with the bold part, so a bold word is wider than it was plain. Clearing the bold removes
 * it and keeps a link on the same characters. The range model and the run measurement are unit-tested
 * (textRanges.test.ts, textRunMeasure.test.ts); this drives the rendered SVG. The Cmd/Ctrl+B toggle comes later, so the
 * weight is set through the store action.
 */
import { test, expect } from '@playwright/test';
import { boot, tool, canvasBox } from './helpers';

async function typeText(page: import('@playwright/test').Page, text: string): Promise<string> {
  await boot(page, { blank: true });
  await tool(page, 'Text').click();
  const box = await canvasBox(page);
  await page.mouse.click(box.x + 280, box.y + 300);
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  return page.evaluate(() => window.__pigmaStore!.getState().file.document.children[0]!.children[0]!.id as string);
}

test('B123a bold on part of a text layer is drawn as a bold tspan on that part only', async ({ page }) => {
  const id = await typeText(page, 'Read the docs');
  await page.evaluate((nodeId) => window.__pigmaStore!.getState().setTextWeight(nodeId, 9, 13, 700), id);

  const bold = page.locator('.canvas__svg tspan[font-weight="700"]');
  await expect(bold).toHaveCount(1);
  await expect(bold).toHaveText('docs');
});

test('B123b the bold part is measured bold, so the auto-width layer grows', async ({ page }) => {
  const id = await typeText(page, 'Read the docs');
  const width = () => page.evaluate(() => window.__pigmaStore!.getState().file.document.children[0]!.children[0]!.width as number);
  // Measured once the faces have loaded, so the plain width is the one a bold face is compared with.
  await page.evaluate(() => document.fonts.ready);
  const plain = await width();

  await page.evaluate((nodeId) => window.__pigmaStore!.getState().setTextWeight(nodeId, 9, 13, 700), id);
  await expect.poll(width).toBeGreaterThan(plain);
});

test('B123c clearing the bold removes it, and a link on the same characters is kept', async ({ page }) => {
  const id = await typeText(page, 'Read the docs');
  await page.evaluate((nodeId) => {
    const store = window.__pigmaStore!.getState();
    store.setTextWeight(nodeId, 9, 13, 700);
    store.setTextLink(nodeId, 9, 13, 'https://docs.example');
  }, id);
  await expect(page.locator('.canvas__svg tspan[font-weight="700"]')).toHaveCount(1);
  await expect(page.locator('.canvas__svg tspan[fill="#0070c4"]')).toHaveCount(1);

  await page.evaluate((nodeId) => window.__pigmaStore!.getState().setTextWeight(nodeId, 9, 13, null), id);
  await expect(page.locator('.canvas__svg tspan[font-weight="700"]')).toHaveCount(0);
  await expect(page.locator('.canvas__svg tspan[fill="#0070c4"]')).toHaveCount(1);
});
