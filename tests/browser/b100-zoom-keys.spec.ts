/**
 * Figma's zoom keys: Shift+0 for 100%, Shift+1 to fit everything, Shift+2 to fit the
 * selection, and Cmd/Ctrl+= and Cmd/Ctrl+- to step. Each is driven and measured on the
 * viewport zoom, so a key that stops reaching the handler fails here.
 */
import { test, expect } from '@playwright/test';
import { boot, drawShape, zoom } from './helpers';

test('B100a Shift+0 sets the view to 100%', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('Shift+Digit0');
  expect(await zoom(page)).toBeCloseTo(1, 3);
});

test('B100b Cmd/Ctrl+= and Cmd/Ctrl+- step the zoom in and out', async ({ page }) => {
  await boot(page);
  const start = await zoom(page);
  await page.keyboard.press('Control+=');
  const zoomedIn = await zoom(page);
  expect(zoomedIn).toBeGreaterThan(start);
  await page.keyboard.press('Control+-');
  await page.keyboard.press('Control+-');
  expect(await zoom(page)).toBeLessThan(zoomedIn);
});

test('B100c Shift+1 brings the view back to fit after zooming in', async ({ page }) => {
  await boot(page);
  const fit = await zoom(page);
  await page.keyboard.press('Control+=');
  await page.keyboard.press('Control+=');
  expect(await zoom(page)).toBeGreaterThan(fit);
  await page.keyboard.press('Shift+Digit1');
  expect(await zoom(page)).toBeCloseTo(fit, 3);
});

test('B100d Shift+2 zooms to the selection, which is larger in view than fit', async ({ page }) => {
  await boot(page);
  await drawShape(page, 'Rectangle', 200, 120);
  await page.keyboard.press('Shift+Digit1');
  const fit = await zoom(page);
  await page.keyboard.press('Shift+Digit2');
  expect(await zoom(page)).toBeGreaterThan(fit);
});
