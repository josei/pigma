/**
 * The Mask type row in the Layer section: a mask is Alpha by default, and the row changes how it reveals what it clips
 * (Figma's Masks help: "To change it, select the layer being used as a mask and open the dropdown"). The rendering is
 * pixel-tested (mask.test.ts, "mask types"); this drives the live panel, checks the change is one undo step, and checks the
 * type survives a reload.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, nextPaint } from './helpers';

/** The mask type the store holds for the first top-level layer after the page's layers, or undefined when unset. */
async function maskTypeOf(page: Page, index: number): Promise<string | undefined> {
  return page.evaluate((at) => {
    const store = window.__pigmaStore;
    if (!store) throw new Error('window.__pigmaStore is not exposed');
    const layers = store.getState().file.document.children[0]!.children as Array<{ maskType?: string }>;
    return layers[at]!.maskType;
  }, index);
}

/** Three overlapping rectangles, the middle one made a mask and selected. Returns nothing: the layers are read by index. */
async function maskedMiddle(page: Page) {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 320, 220, 0, 0);
  await drawShape(page, 'Rectangle', 160, 120, 0, 0);
  await drawShape(page, 'Rectangle', 320, 220, 0, 0);
  await page.evaluate(() => {
    const store = window.__pigmaStore!;
    const layers = store.getState().file.document.children[0]!.children as Array<{ id: string }>;
    store.getState().select([layers[1]!.id], 'replace');
  });
  await page.keyboard.press('Control+Alt+m');
  await nextPaint(page);
}

test('B165a the Mask type row changes how the selected mask reveals, and one undo puts it back', async ({ page }) => {
  await maskedMiddle(page);
  const row = page.locator('select[aria-label="Mask type"]');
  await expect(row).toHaveCount(1);
  await expect(row).toHaveValue('ALPHA');

  await row.selectOption('VECTOR');
  await nextPaint(page);
  expect(await maskTypeOf(page, 1)).toBe('VECTOR');
  await expect(row).toHaveValue('VECTOR');

  // One undo entry: a single undo returns the mask to the default, Alpha.
  await page.keyboard.press('Control+z');
  await nextPaint(page);
  expect(await maskTypeOf(page, 1)).toBeUndefined();
  await expect(row).toHaveValue('ALPHA');
});

test('B165b a Luminance mask type survives a reload', async ({ page }) => {
  await maskedMiddle(page);
  await page.locator('select[aria-label="Mask type"]').selectOption('LUMINANCE');
  await nextPaint(page);

  // Reload WITHOUT ?blank=1, since that flag boots a fresh empty document (see B53f).
  await page.goto('/app/');
  await page.waitForSelector('.app');
  await nextPaint(page);
  expect(await maskTypeOf(page, 1), 'the mask type did not round-trip through persistence').toBe('LUMINANCE');
});
