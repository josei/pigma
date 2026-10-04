import { test, expect, type Page } from '@playwright/test';
import { boot, openMenu } from './helpers';

const FIXTURES = 'tests/figma/fixtures';

/** Import a fixture through the real menu + file chooser. */
async function importFixture(page: Page, menuLabel: string, file: string) {
  await boot(page);
  await openMenu(page);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('.menu__item', { hasText: menuLabel }).first().click(),
  ]);
  await chooser.setFiles(`${FIXTURES}/${file}`);
  await page.waitForTimeout(1000);
}

function toast(page: Page) {
  return page.locator('.toast').first();
}

test('B11a a native .fig file imports', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await importFixture(page, 'Import .fig…', 'circle.fig');

  await expect(page.locator('.layer-row').first()).toBeVisible();
  await expect(toast(page)).toContainText('Imported');
  expect(errors).toEqual([]);
});

test('B11b a .fig file with outline/stroke geometry imports', async ({ page }) => {
  await importFixture(page, 'Import .fig…', 'word-outline-stroke.fig');
  await expect(toast(page)).toContainText('Imported');
  await expect(page.locator('.canvas__svg path').first()).toBeVisible();
});

test('B11c the openfigs .fig file imports', async ({ page }) => {
  await importFixture(page, 'Import .fig…', 'openfigs.fig');
  await expect(toast(page)).toContainText('Imported');
  await expect(page.locator('.layer-row').first()).toBeVisible();
});

test('B11d a Figma REST file document imports with gradients', async ({ page }) => {
  await importFixture(page, 'Import Figma JSON…', 'rest-file.json');

  await expect(toast(page)).toContainText('Imported');
  await expect(page.locator('.canvas__svg linearGradient').first()).toBeAttached();
  const gradients = await page.locator('.canvas__svg linearGradient, .canvas__svg radialGradient').count();
  expect(gradients).toBeGreaterThan(0);
});

test('B11e the Figma REST nodes endpoint imports', async ({ page }) => {
  await importFixture(page, 'Import Figma JSON…', 'rest-nodes.json');
  await expect(toast(page)).toContainText('Imported');
  await expect(page.locator('.page-row__name', { hasText: 'Imported nodes' })).toHaveCount(1);
});

test('B11f unsupported Figma features are reported, not silently dropped', async ({ page }) => {
  await importFixture(page, 'Import Figma JSON…', 'rest-file.json');

  const text = (await toast(page).textContent()) ?? '';
  expect(text).toMatch(/unsupported/i);
  // The report names the specific constructs it could not represent.
  expect(text).toMatch(/paint:|effect:|ellipse:|text:|layout:|component/i);
});

/**
 * The fixture's document carries an IMAGE fill referencing the bytes embedded in
 * its ZIP, so this asserts the whole path: archive bytes -> ImagePaint.dataUrl
 * -> rendered `<pattern><image>` in the canvas SVG.
 */
test('B11g a .fig file with an embedded image imports it', async ({ page }) => {
  await importFixture(page, 'Import .fig…', 'with-image.fig');

  const rendered = await page.evaluate(() => {
    const svg = document.querySelector('.canvas__svg')!;
    return svg.querySelectorAll('image, pattern').length;
  });
  expect(rendered).toBeGreaterThan(0);
});
