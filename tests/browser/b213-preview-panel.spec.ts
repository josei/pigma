/**
 * While the animation preview is on, the side panel shows the drawn values, and its fields are held, as the canvas holds the layer's
 * edits. Stopping the preview shows the stored values again, and the fields work. The keyframe values are unit-tested
 * (keyframes.test.ts); this drives the live panel.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, field, nextPaint, tool } from './helpers';

async function drawRectangle(page: Page): Promise<void> {
  await tool(page, 'Rectangle').click();
  const box = (await page.locator('.canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx - 80, cy - 50);
  await page.mouse.down();
  await page.mouse.move(cx + 80, cy + 50, { steps: 8 });
  await page.mouse.up();
  await nextPaint(page);
}

test('B213a the panel shows the drawn opacity during the preview, holds its fields, and shows the stored value again after', async ({ page }: { page: Page }) => {
  await boot(page, { blank: true });
  await drawRectangle(page);
  // Opacity fades from 100% at 0 ms to 0% at 1000 ms. The stored layer stays at 100%.
  await page.evaluate(() => {
    window.__pigmaStore!.getState().updateSelected({
      keyframes: [{ property: 'opacity', keys: [{ time: 0, value: 1 }, { time: 1000, value: 0 }] }],
    } as never, 'Key opacity');
  });
  await nextPaint(page);
  await field(page, 'Key time (ms)').fill('500');
  await field(page, 'Key time (ms)').press('Enter');
  await page.getByRole('button', { name: 'Preview keys' }).click();
  await nextPaint(page);

  // Halfway through the fade the drawn opacity is 50%, and the field is held.
  await expect(field(page, 'Opacity')).toHaveValue('50');
  await expect(field(page, 'Opacity')).toBeDisabled();

  // The preview's own control stays usable, and stopping it restores the stored value and the field.
  await page.getByRole('button', { name: 'Stop preview' }).click();
  await nextPaint(page);
  await expect(field(page, 'Opacity')).toHaveValue('100');
  await expect(field(page, 'Opacity')).toBeEnabled();
});
