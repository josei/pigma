import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, field, nodeGeometry, nextPaint } from './helpers';

/** Select a layer row by its name. */
async function selectLayer(page: Page, name: string) {
  await page.locator('.layer-row', { hasText: name }).first().click();
  await nextPaint(page);
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
  await nextPaint(page);

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
  await nextPaint(page);

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
  await nextPaint(page);
  await autoLayout.locator('.segmented__option', { hasText: 'Column' }).click();
  await nextPaint(page);

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
  await nextPaint(page);
  await expect(field(page, 'Gap')).toHaveCount(1);

  await autoLayout.locator('.segmented__option', { hasText: 'None' }).click();
  await nextPaint(page);
  await expect(field(page, 'Gap')).toHaveCount(0);
});

test('B13e a negative Gap overlaps the children, and the field keeps the negative value', async ({ page }) => {
  const { frame, a, b } = await frameWithTwoRects(page);
  await selectLayer(page, frame);
  const autoLayout = page.locator('.section', { has: page.locator('.section__header', { hasText: 'Auto layout' }) });
  await autoLayout.locator('.segmented__option', { hasText: 'Row' }).click();
  await nextPaint(page);

  const gap = field(page, 'Gap');
  await gap.fill('-10');
  await gap.press('Enter');
  await nextPaint(page);
  await expect(gap).toHaveValue('-10');

  await selectLayer(page, a);
  const first = await nodeGeometry(page);
  await selectLayer(page, b);
  const second = await nodeGeometry(page);
  // The second child starts one width less the 10px overlap after the first.
  expect(second.x - first.x).toBeCloseTo(first.w - 10, 0);
});

test('B13f Include stroke in layout moves the children apart by the stroke, and the geometry keeps its size', async ({ page }) => {
  const { frame, a, b } = await frameWithTwoRects(page);
  // Each child gets a 10px centred stroke ("Mid"), so its layout box is 10px wider with the flag on. New rectangles
  // default to an inside stroke, which adds nothing to the box.
  const appearance = page.locator('.section', { has: page.locator('.section__header', { hasText: 'Appearance' }) });
  for (const name of [a, b]) {
    await selectLayer(page, name);
    await page.getByRole('button', { name: 'Add Stroke' }).click();
    await field(page, 'Weight').fill('10');
    await field(page, 'Weight').press('Enter');
    await appearance.locator('.segmented__option', { hasText: 'Mid' }).click();
    await nextPaint(page);
  }

  await selectLayer(page, frame);
  const autoLayout = page.locator('.section', { has: page.locator('.section__header', { hasText: 'Auto layout' }) });
  await autoLayout.locator('.segmented__option', { hasText: 'Row' }).click();
  await nextPaint(page);

  const gapBetween = async () => {
    await selectLayer(page, a);
    const first = await nodeGeometry(page);
    await selectLayer(page, b);
    const second = await nodeGeometry(page);
    return { distance: second.x - first.x, width: first.w };
  };
  const before = await gapBetween();

  await selectLayer(page, frame);
  await page.getByLabel('Include stroke in layout').check();
  await nextPaint(page);
  const after = await gapBetween();

  expect(after.distance - before.distance).toBeCloseTo(10, 0);
  expect(after.width, 'the geometry keeps its size, the stroke is only in the box').toBeCloseTo(before.width, 0);
});

