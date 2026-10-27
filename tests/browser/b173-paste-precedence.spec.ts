/**
 * Paste precedence: with a layer copied in Pigma, Ctrl/Cmd+V pastes that layer and nothing else. The browser also fires a paste
 * event on the same key, and the canvas places any image on the system clipboard from it. Another image left on the system
 * clipboard (by a Copy as PNG, say) must not add a layer to the paste.
 */
import { test, expect } from '@playwright/test';
import { boot, drawShape, nextPaint } from './helpers';

const APP_ORIGIN = 'http://127.0.0.1:5173';

test('B173a Ctrl+V after copying a layer pastes that layer only, even with an image on the system clipboard', async ({ page, context }) => {
  test.skip(test.info().project.name !== 'chromium', 'Playwright grants clipboard permissions only in Chromium');
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: APP_ORIGIN });
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 40, 40, 0, 0);
  await nextPaint(page);

  await page.keyboard.press('ControlOrMeta+c');
  await expect.poll(() => page.evaluate(() => window.__pigmaStore!.getState().clipboard?.length ?? 0)).toBe(1);

  // Another application's image, on the system clipboard after the copy.
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob! })]);
  });

  const layers = () => page.evaluate(() => (window.__pigmaStore!.getState().file.document.children[0]!.children as Array<{ name: string }>).map((layer) => layer.name));
  const before = await layers();
  await page.keyboard.press('ControlOrMeta+v');
  // The image path decodes asynchronously, so a layer it would add arrives after the key. Give it time to show, then check.
  await page.waitForTimeout(800);
  const after = await layers();

  expect(after.length - before.length, `layers after the paste: ${JSON.stringify(after)}`).toBe(1);
  expect(after.filter((name) => name === 'Image'), `an image layer was added by the paste: ${JSON.stringify(after)}`).toHaveLength(0);
});

test('B173b Ctrl+V with nothing copied in Pigma still pastes an image from the system clipboard', async ({ page, context }) => {
  test.skip(test.info().project.name !== 'chromium', 'Playwright grants clipboard permissions only in Chromium');
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: APP_ORIGIN });
  await boot(page, { blank: true });
  await nextPaint(page);

  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob! })]);
  });
  await page.keyboard.press('ControlOrMeta+v');
  await expect.poll(() =>
    page.evaluate(() => (window.__pigmaStore!.getState().file.document.children[0]!.children as Array<{ name: string }>).map((layer) => layer.name)),
  ).toContain('Image');
});
