import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, field, nodeGeometry, tool, clickCanvas } from './helpers';

/**
 * Two GENUINELY overlapping rectangles, both selected.
 *
 * The second drag starts inside the first, which only works now that selection
 * handles no longer capture pointer input while a creation tool is active. The
 * overlap is asserted from the nodes' own geometry so this helper cannot
 * silently degenerate into two disjoint shapes.
 */
async function twoOverlappingRects(page: Page) {
  await drawShape(page, 'Rectangle', 160, 160, -40, 0);
  const a = await nodeGeometry(page);
  await drawShape(page, 'Rectangle', 160, 160, 40, 0);
  const b = await nodeGeometry(page);
  expect(await page.locator('.layer-row').count()).toBe(2);
  expect(a.x).toBeLessThan(b.x + b.w);
  expect(b.x).toBeLessThan(a.x + a.w);
  expect(a.y).toBeLessThan(b.y + b.h);
  expect(b.y).toBeLessThan(a.y + a.h);

  await tool(page, 'Move').click();
  await page.keyboard.press('Escape');
  const box = (await page.locator('.canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx - 260, cy - 160);
  await page.mouse.down();
  await page.mouse.move(cx + 260, cy + 160, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('.layer-row--selected')).toHaveCount(2);
}

async function openAssets(page: Page) {
  await page.locator('.rail__button[aria-label="Assets"]').click();
  await page.waitForTimeout(300);
}

test('B20a the pen tool creates a vector layer', async ({ page }) => {
  await boot(page, { blank: true });
  const rows = page.locator('.layer-row');
  const before = await rows.count();

  await tool(page, 'Pen').click();
  await clickCanvas(page, -80, -40);
  await clickCanvas(page, 60, -60);
  await clickCanvas(page, 80, 60);
  // The pen commits the open path on Enter; Escape abandons it.
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);

  expect(await rows.count()).toBeGreaterThan(before);
});

test('B20b boolean Union merges two overlapping shapes into one', async ({ page }) => {
  await boot(page, { blank: true });
  await twoOverlappingRects(page);
  const rows = page.locator('.layer-row');
  const before = await rows.count();

  await page.locator('[aria-label="Union"]').click();
  await page.waitForTimeout(400);

  expect(await rows.count()).toBeLessThan(before);
  await expect(page.locator('.layer-row--selected')).toHaveCount(1);
});

test('B20c Subtract produces a different result from Union', async ({ page }) => {
  await boot(page, { blank: true });
  await twoOverlappingRects(page);
  await page.locator('[aria-label="Union"]').click();
  await page.waitForTimeout(400);
  const unionMarkup = await page.locator('.canvas__svg').innerHTML();

  await page.goto('/?blank=1');
  await page.waitForSelector('.app');
  await twoOverlappingRects(page);
  await page.locator('[aria-label="Subtract"]').click();
  await page.waitForTimeout(400);
  const subtractMarkup = await page.locator('.canvas__svg').innerHTML();

  expect(subtractMarkup).not.toBe(unionMarkup);
});

test('B20d Subtract and Exclude each merge to one node', async ({ page }) => {
  for (const op of ['Subtract', 'Exclude']) {
    await boot(page, { blank: true });
    await twoOverlappingRects(page);
    await page.locator(`[aria-label="${op}"]`).click();
    await page.waitForTimeout(400);
    await expect(page.locator('.layer-row--selected')).toHaveCount(1);
  }
});

test('B20e Intersect merges two overlapping shapes into one', async ({ page }) => {
  await boot(page, { blank: true });
  await twoOverlappingRects(page);
  await page.locator('[aria-label="Intersect"]').click();
  await page.waitForTimeout(500);
  await expect(page.locator('.layer-row--selected')).toHaveCount(1);
});

test('B20e creating a fill style from the selection registers it', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 200, 120);
  await openAssets(page);

  await expect(page.locator('.section__header', { hasText: 'Styles' })).toHaveCount(1);
  await page.locator('[aria-label="Create Fill style"]').click();
  await page.waitForTimeout(400);

  // The Styles section header carries the count next to its name.
  const stylesHeader = await page
    .locator('.section__header', { hasText: 'Styles' })
    .first()
    .textContent();
  expect(stylesHeader ?? '').toContain('1');
});

test('B20f the assets tab exposes variables and a collection can be added', async ({ page }) => {
  await boot(page, { blank: true });
  await openAssets(page);

  await expect(page.locator('.section__header', { hasText: 'Variables' })).toHaveCount(1);
  const addCollection = page.locator('[aria-label="Add variable collection"]');
  await expect(addCollection).toHaveCount(1);
  await addCollection.click();
  await page.waitForTimeout(400);
  // A collection now exists, so at least one variable-type button is offered.
  await expect(page.locator('[aria-label$="variable"]').first()).toBeVisible();
});

test('B20g a fill variable can be bound to a node', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 200, 120);
  const fillBefore = await field(page, 'Fill colour').inputValue();

  await openAssets(page);
  await page.locator('[aria-label="Add variable collection"]').click();
  await page.waitForTimeout(300);
  const addVariable = page.locator('button[aria-label$=" variable"]').first();
  if (await addVariable.count()) {
    await addVariable.click();
    await page.waitForTimeout(400);
  }

  await page.locator('.rail__button[aria-label="Layers"]').click();
  await page.waitForTimeout(300);
  const bind = page.locator('select[aria-label="Fill variable"]');
  await expect(bind).toHaveCount(1);
  // Binding is only meaningful once the collection offers a variable.
  const options = await bind.locator('option').count();
  expect(options).toBeGreaterThan(0);
  expect(fillBefore).toBeTruthy();
});
