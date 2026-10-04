import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, field, tool } from './helpers';

/** Create a component from a fresh rectangle and return its layer name. */
async function createComponent(page: Page) {
  await drawShape(page, 'Rectangle', 180, 120);
  await tool(page, 'Create component').click();
  await page.waitForTimeout(300);
  return (await page.locator('.layer-row--selected .layer-row__name').first().textContent())!;
}

/** Insert an instance of the named asset from the Assets tab. */
async function insertInstance(page: Page, name: string) {
  await page.locator('.rail__button[aria-label="Assets"]').click();
  await page.locator('.app__left .layer-row', { hasText: name }).first().dblclick();
  await page.waitForTimeout(400);
  await page.locator('.rail__button[aria-label="Layers"]').click();
}

test('B12a creating a component marks the layer as a component', async ({ page }) => {
  await boot(page);
  await drawShape(page, 'Rectangle', 180, 120);
  const iconBefore = await page.locator('.layer-row--selected .layer-row__icon svg').first().innerHTML();

  await tool(page, 'Create component').click();
  await page.waitForTimeout(300);

  const iconAfter = await page.locator('.layer-row--selected .layer-row__icon svg').first().innerHTML();
  expect(iconAfter).not.toBe(iconBefore);
  // The component glyph is the four-diamond mark.
  expect(iconAfter).toContain('M8 1.5 11 4.5 8 7.5 5 4.5Z');
});

test('B12b the component appears in the Assets tab', async ({ page }) => {
  await boot(page);
  const name = await createComponent(page);

  await page.locator('.rail__button[aria-label="Assets"]').click();
  await expect(page.locator('.app__left .section__header', { hasText: 'Components' })).toHaveCount(1);
  await expect(page.locator('.app__left .layer-row', { hasText: name })).toHaveCount(1);
});

test('B12c double-clicking an asset inserts an instance', async ({ page }) => {
  await boot(page, { blank: true });
  const name = await createComponent(page);
  const layersBefore = await page.locator('.layer-row').count();

  await insertInstance(page, name);
  await expect.poll(async () => page.locator('.layer-row').count()).toBeGreaterThan(layersBefore);
});

test('B12d editing an instance does not change its main component', async ({ page }) => {
  await boot(page, { blank: true });
  const name = await createComponent(page);
  const componentFill = await field(page, 'Fill colour').inputValue();

  await insertInstance(page, name);

  // A component and its instance share the layer name, so tell them apart by
  // glyph: the master carries the four-diamond component mark, the instance the
  // smaller two-diamond mark.
  // Names are identical by design, so identify rows purely by glyph.
  const masterRow = page
    .locator('.layer-row')
    .filter({ has: page.locator('.layer-row__icon path[d*="M8 1.5 11 4.5"]') });
  const instanceRow = page
    .locator('.layer-row')
    .filter({ has: page.locator('.layer-row__icon path[d*="M8 2.6 10.4 5"]') });

  await expect(masterRow).toHaveCount(1);
  await expect(instanceRow).toHaveCount(1);

  // The freshly inserted instance is selected: give it a different fill.
  await field(page, 'Fill colour').fill('#ff0000');
  await field(page, 'Fill colour').press('Enter');
  await page.waitForTimeout(200);
  expect(await field(page, 'Fill colour').inputValue()).toBe('#ff0000');

  // The override stays on the instance...
  await instanceRow.first().click();
  await expect(field(page, 'Fill colour')).toHaveValue('#ff0000');

  // ...and the master keeps its own fill.
  await masterRow.first().click();
  await expect(field(page, 'Fill colour')).toHaveValue(componentFill);
});
