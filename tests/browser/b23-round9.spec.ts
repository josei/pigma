import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, field, nodeGeometry, openMenu } from './helpers';

/** A frame with three children, frame selected and set to a Row layout. */
async function rowFrame(page: Page, frameWidth?: number) {
  await boot(page, { blank: true });
  await drawShape(page, 'Frame', 420, 300, 0, 0);
  const frame = (await page.locator('.layer-row--selected .layer-row__name').first().textContent())!;
  // Deliberately different heights: wrapped one-per-line, a uniform height gives
  // counter alignment nothing to move inside a line.
  await drawShape(page, 'Rectangle', 90, 40, -110, -60);
  await drawShape(page, 'Rectangle', 90, 80, 0, -60);
  await drawShape(page, 'Rectangle', 90, 40, 110, -60);

  await page.locator('.layer-row', { hasText: frame }).first().click();
  await page.waitForTimeout(200);
  await page.locator('[aria-label="Direction"] button').filter({ hasText: /^Row$/ }).first().click();
  await page.waitForTimeout(300);
  if (frameWidth !== undefined) {
    // Typing a size on an auto-layout frame PINS that axis to fixed; if it does
    // not stick, wrapping can never be required and the test below is vacuous.
    await field(page, 'W').fill(String(frameWidth));
    await field(page, 'W').press('Enter');
    await page.waitForTimeout(400);
    expect(Number(await field(page, 'W').inputValue())).toBeCloseTo(frameWidth, 0);
  }
  return frame;
}

/** Y of every Rectangle child, read by selecting each through the layers list. */
async function childYs(page: Page) {
  const names = (await page.locator('.layer-row__name').allTextContents()).filter((n) => /Rectangle/.test(n));
  const ys: number[] = [];
  for (const name of names) {
    await page.locator('.layer-row', { hasText: name }).first().click();
    await page.waitForTimeout(150);
    ys.push(Math.round(Number(await field(page, 'Y').inputValue())));
  }
  return ys;
}

test('B23a Wrap packs children onto extra lines', async ({ page }) => {
  // Narrow frame: three 90px children with gaps cannot fit on one line.
  await rowFrame(page, 200);
  const before = await childYs(page);
  expect(new Set(before).size, `expected a single row before wrapping, got ${JSON.stringify(before)}`).toBe(1);

  await page.locator('.layer-row', { hasText: 'Frame' }).first().click();
  await page.locator('[aria-label="Wrap"] button').filter({ hasText: /^Wrap$/ }).first().click();
  await page.waitForTimeout(400);

  const after = await childYs(page);
  expect(new Set(after).size, `children did not wrap: ${JSON.stringify(after)}`).toBeGreaterThan(1);
});

test('B23b wrapping back to No wrap restores a single line', async ({ page }) => {
  await rowFrame(page, 200);
  await page.locator('.layer-row', { hasText: 'Frame' }).first().click();
  await page.locator('[aria-label="Wrap"] button').filter({ hasText: /^Wrap$/ }).first().click();
  await page.waitForTimeout(400);
  expect((await childYs(page)).length).toBe(3);

  await page.locator('.layer-row', { hasText: 'Frame' }).first().click();
  await page.locator('[aria-label="Wrap"] button').filter({ hasText: /^No wrap$/ }).first().click();
  await page.waitForTimeout(400);

  const after = await childYs(page);
  expect(new Set(after).size).toBe(1);
});

test('B23c a line-gap control appears with Wrap and changes the packed height', async ({ page }) => {
  await rowFrame(page, 200);
  await page.locator('.layer-row', { hasText: 'Frame' }).first().click();
  await page.locator('[aria-label="Wrap"] button').filter({ hasText: /^Wrap$/ }).first().click();
  await page.waitForTimeout(400);

  // With wrapping on, the frame hugs its height, so a larger line gap must make
  // the packed height grow.
  const lineGap = field(page, 'Line gap');
  await expect(lineGap).toHaveCount(1);
  const frame = page.locator('.layer-row', { hasText: 'Frame' }).first();
  await frame.click();
  const before = await nodeGeometry(page);

  await lineGap.fill('60');
  await lineGap.press('Enter');
  await page.waitForTimeout(400);

  await frame.click();
  const after = await nodeGeometry(page);
  expect(after.h).toBeGreaterThan(before.h);
});

test('B23d per-line alignment repositions wrapped children', async ({ page }) => {
  // Wide enough for TWO children per line: counter alignment can only move a
  // child that is shorter than its line, which needs a mixed-height line.
  const frame = await rowFrame(page, 260);
  await page.locator('.layer-row', { hasText: frame }).first().click();
  await page.locator('[aria-label="Wrap"] button').filter({ hasText: /^Wrap$/ }).first().click();
  await page.waitForTimeout(400);

  await page.locator('.layer-row', { hasText: frame }).first().click();

  // Counter-axis alignment positions each wrapped LINE, so the children's Y
  // values must move when it changes.
  const counter = page.locator('[aria-label="Counter align"]');
  await expect(counter).toHaveCount(1);
  const options = await counter.locator('button').allTextContents();
  expect(options.length).toBeGreaterThan(1);
  await counter.locator('button').first().click();
  await page.waitForTimeout(400);
  const first = await childYs(page);
  await page.locator('.layer-row', { hasText: frame }).first().click();
  await counter.locator('button').last().click();
  await page.waitForTimeout(400);
  const last = await childYs(page);

  expect(JSON.stringify(last), `counter align did not move the lines: ${JSON.stringify(first)} vs ${JSON.stringify(last)}`).not.toBe(
    JSON.stringify(first),
  );
});

// ------------------------------------------------------- export selection ----

test('B23e Export selection as SVG contains only the selection', async ({ page }) => {
  await boot(page, { blank: true });
  // Two separate shapes; only one is selected for export.
  await drawShape(page, 'Rectangle', 200, 120, -200, 0);
  const exported = (await page.locator('.layer-row--selected .layer-row__name').first().textContent())!;
  await drawShape(page, 'Rectangle', 180, 100, 200, 0);
  const other = (await page.locator('.layer-row--selected .layer-row__name').first().textContent())!;

  await page.locator('.layer-row', { hasText: exported }).first().click();
  await page.waitForTimeout(200);

  await openMenu(page);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.menu__item', { hasText: 'Export selection as SVG' }).first().click(),
  ]);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const svg = Buffer.concat(chunks).toString('utf8');

  expect(svg).toContain('<svg');
  expect(svg).toContain('<rect');
  // Exactly one shape: the other rectangle must not be in the export.
  const rects = (svg.match(/<rect/g) ?? []).length;
  expect(rects, `expected a single exported rect, found ${rects} in ${svg.slice(0, 200)}`).toBe(1);
  expect(other).not.toBe(exported);
});

test('B23f Copy as PNG puts a PNG image on the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: 'http://127.0.0.1:5173',
  });
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 200, 120);

  await openMenu(page);
  await page.locator('.menu__item', { hasText: 'Copy as PNG' }).first().click();

  // The item is written a few tens of ms after the click, so poll rather than
  // race it with a fixed wait.
  await expect
    .poll(
      async () =>
        page.evaluate(async () => (await navigator.clipboard.read()).flatMap((item) => item.types)),
      { timeout: 5000 },
    )
    .toContain('image/png');
});

test('B23g Export selection as PNG produces a PNG of the selection size', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 200, 120);
  const geom = await nodeGeometry(page);

  await openMenu(page);

  // The item may open a dialog or download directly; accept either, then assert
  // on whatever PNG we can obtain.
  const downloadPromise = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
  await page.locator('.menu__item', { hasText: 'Export selection as PNG' }).first().click();
  const download = await downloadPromise;

  if (!download) {
    // A dialog path: drive it and take the resulting download.
    const modal = page.locator('.modal');
    await expect(modal).toHaveCount(1, { timeout: 5000 });
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      modal.locator('.button--primary').click(),
    ]);
    const stream = await dl.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const buf = Buffer.concat(chunks);
    expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(buf.readUInt32BE(16)).toBeCloseTo(geom.w, 0);
    return;
  }

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const buf = Buffer.concat(chunks);
  expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG');
  expect(buf.readUInt32BE(16)).toBeCloseTo(geom.w, 0);
  expect(buf.readUInt32BE(20)).toBeCloseTo(geom.h, 0);
});
