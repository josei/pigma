import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, field, nodeGeometry } from './helpers';

/** Select a layer row by its name. */
async function selectLayer(page: Page, name: string) {
  await page.locator('.layer-row', { hasText: name }).first().click();
  await page.waitForTimeout(150);
}

/** Draw a frame with two rectangles inside it (auto layout needs children). */
async function frameWithTwoRects(page: Page) {
  await boot(page);
  await page.locator('button[aria-label="Add page"]').click();
  await drawShape(page, 'Frame', 420, 300);
  const frame = (await page.locator('.layer-row--selected .layer-row__name').first().textContent())!;

  // Drawing inside the frame's bounds should parent the shapes to it.
  await drawShape(page, 'Rectangle', 100, 80, -110, -50);
  const a = (await page.locator('.layer-row--selected .layer-row__name').first().textContent())!;
  await drawShape(page, 'Rectangle', 100, 80, 110, 50);
  const b = (await page.locator('.layer-row--selected .layer-row__name').first().textContent())!;

  return { frame, a, b };
}

test('B13a choosing Row applies auto layout to a frame', async ({ page }) => {
  const { frame } = await frameWithTwoRects(page);
  await selectLayer(page, frame);

  const autoLayout = page.locator('.section', { has: page.locator('.section__header', { hasText: 'Auto layout' }) });
  await expect(autoLayout).toHaveCount(1);

  await autoLayout.locator('.segmented__option', { hasText: 'Row' }).click();
  await page.waitForTimeout(300);

  // Layout fields only exist once a direction is chosen.
  await expect(field(page, 'Gap')).toHaveCount(1);
  await expect(field(page, 'Pad T')).toHaveCount(1);
});

test('B13b Row aligns children on one line and orders them left to right', async ({ page }) => {
  const { frame, a, b } = await frameWithTwoRects(page);

  await selectLayer(page, a);
  const beforeA = await nodeGeometry(page);
  await selectLayer(page, b);
  const beforeB = await nodeGeometry(page);
  expect(beforeA.y).not.toBeCloseTo(beforeB.y, 0);

  await selectLayer(page, frame);
  const autoLayout = page.locator('.section', { has: page.locator('.section__header', { hasText: 'Auto layout' }) });
  await autoLayout.locator('.segmented__option', { hasText: 'Row' }).click();
  await page.waitForTimeout(300);

  await selectLayer(page, a);
  const afterA = await nodeGeometry(page);
  await selectLayer(page, b);
  const afterB = await nodeGeometry(page);

  // A row packs the children onto a shared line, first child leftmost.
  expect(afterA.y).toBeCloseTo(afterB.y, 0);
  expect(afterA.x).toBeLessThan(afterB.x);
});

test('B13c switching to Column stacks children vertically', async ({ page }) => {
  const { frame, a, b } = await frameWithTwoRects(page);
  await selectLayer(page, frame);

  const autoLayout = page.locator('.section', { has: page.locator('.section__header', { hasText: 'Auto layout' }) });
  await autoLayout.locator('.segmented__option', { hasText: 'Row' }).click();
  await page.waitForTimeout(250);
  await autoLayout.locator('.segmented__option', { hasText: 'Column' }).click();
  await page.waitForTimeout(250);

  await selectLayer(page, a);
  const afterA = await nodeGeometry(page);
  await selectLayer(page, b);
  const afterB = await nodeGeometry(page);

  expect(afterA.x).toBeCloseTo(afterB.x, 0);
  expect(afterA.y).toBeLessThan(afterB.y);
});

test('B13d clearing auto layout removes the layout fields', async ({ page }) => {
  const { frame } = await frameWithTwoRects(page);
  await selectLayer(page, frame);

  const autoLayout = page.locator('.section', { has: page.locator('.section__header', { hasText: 'Auto layout' }) });
  await autoLayout.locator('.segmented__option', { hasText: 'Row' }).click();
  await page.waitForTimeout(250);
  await expect(field(page, 'Gap')).toHaveCount(1);

  await autoLayout.locator('.segmented__option', { hasText: 'None' }).click();
  await page.waitForTimeout(250);
  await expect(field(page, 'Gap')).toHaveCount(0);
});
