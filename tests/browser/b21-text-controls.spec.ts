/**
 * The two controls nobody had measured, judged by what they RENDER.
 *
 * Decorate sets `style.textDecoration`, and the renderer emits it as
 * `text-decoration` on the `<text>`; line height becomes each tspan's `dy`; letter
 * spacing reaches both the measurement and the glyphs. Each assertion below reads
 * the RENDERED SVG, not the model field.
 */
import { test, expect } from '@playwright/test';
import { boot, drawShape, field, tool } from './helpers';

/** The rendered text node's SVG element. */
// Scoped to the CANVAS and matched by CONTENT: every icon is an `<svg>` too, and
// the canvas SVG's first `<text>` is chrome (grid labels), so an unscoped selector
// picks up the wrong element.
const renderedText = (page: import('@playwright/test').Page, contains: string) =>
  page.locator('.canvas__svg text').filter({ hasText: contains }).first();

test('Decorate renders as a decoration on the text, not just a model field', async ({ page }) => {
  await boot(page);
  await tool(page, 'Text');
  await drawShape(page, 'Text', 200, 60);
  await page.keyboard.press('Enter');
  await page.keyboard.type('Decorate me');
  await page.keyboard.press('Escape');

  const target = () => renderedText(page, 'Decorate me');
  await expect(target()).toHaveCount(1);
  expect(await target().evaluate((el) => el.style.textDecoration || 'none')).toBe('none');

  await page.getByRole('button', { name: 'U̲' }).click();
  await expect
    .poll(async () => target().evaluate((el) => el.style.textDecoration), { timeout: 5000 })
    .toBe('underline');

  await page.getByRole('button', { name: 'S̶' }).click();
  await expect
    .poll(async () => target().evaluate((el) => el.style.textDecoration), { timeout: 5000 })
    .toBe('line-through');
});

test('line height moves the rendered tspans apart on a WRAPPING node', async ({ page }) => {
  await boot(page);
  await tool(page, 'Text');
  await drawShape(page, 'Text', 160, 40);
  await page.keyboard.press('Enter');
  // Long enough to wrap: a single-line node cannot show a line-height change.
  await page.keyboard.type('The quick brown fox jumps over the lazy dog and keeps running past the edge');
  await page.keyboard.press('Escape');

  const tspans = () => renderedText(page, 'The quick brown fox').locator('tspan');
  expect(await tspans().count(), 'the node did not wrap').toBeGreaterThan(1);
  const dys = () =>
    tspans().evaluateAll((els) => els.map((el) => Number((el as SVGTSpanElement).getAttribute('dy') ?? 0)));
  const before = await dys();

  await field(page, 'Line height').fill('240');
  await field(page, 'Line height').press('Enter');
  await expect.poll(async () => (await dys())[1], { timeout: 5000 }).toBeGreaterThan(before[1] ?? 0);
});

test('letter spacing changes the rendered advance', async ({ page }) => {
  await boot(page);
  await tool(page, 'Text');
  await drawShape(page, 'Text', 200, 40);
  await page.keyboard.press('Enter');
  await page.keyboard.type('SPACING');
  await page.keyboard.press('Escape');

  const width = async (): Promise<number> => (await renderedText(page, 'SPACING').boundingBox())?.width ?? 0;
  const before = await width();
  // The panel's field label is "Letter" (the unit is the control's own suffix).
  await field(page, 'Letter').fill('20');
  await field(page, 'Letter').press('Enter');
  await expect.poll(width, { timeout: 5000 }).toBeGreaterThan(before);
});
