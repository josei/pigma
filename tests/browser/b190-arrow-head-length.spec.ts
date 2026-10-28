/**
 * The Head length field sets an arrow cap's head length, in stroke weights, and only shows for an arrow cap. The geometry is
 * unit-tested (arrowheads.test.ts, outline.test.ts); this drives the live panel.
 */
import { test, expect } from '@playwright/test';
import { boot, nextPaint } from './helpers';

test('B190a the Head length field appears for an arrow cap and sets its length', async ({ page }) => {
  await boot(page, { blank: true });
  await page.locator('.toolbar__button[aria-label="Line"]').click();
  const box = (await page.locator('.canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx - 120, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 120, cy, { steps: 8 });
  await page.mouse.up();
  await nextPaint(page);
  await page.evaluate(() => {
    window.__pigmaStore!.getState().updateSelected(
      { strokes: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 1 }], strokeWeight: 6 } as never,
      'Set stroke',
    );
  });
  await nextPaint(page);

  const head = page.locator('input[aria-label="Head length"]');
  // A plain cap has no head, so the field is not shown.
  await expect(head).toHaveCount(0);
  await page.getByLabel('Stroke cap', { exact: true }).selectOption('ARROW_EQUILATERAL');
  await nextPaint(page);
  await expect(head).toBeVisible();
  await expect(head).toHaveValue('5');
  await head.fill('10');
  await head.press('Enter');
  await nextPaint(page);
  const stored = await page.evaluate(() => (window.__pigmaStore!.getState().file.document.children[0]!.children[0] as unknown as { arrowHeadLength?: number }).arrowHeadLength);
  expect(stored).toBe(10);
});
