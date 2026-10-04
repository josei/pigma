import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, field, openMenu } from './helpers';

/** Open the Plugins rail tab. */
async function openPlugins(page: Page) {
  const tab = page.locator('.rail__button[aria-label="Plugins"]');
  await expect(tab).toHaveCount(1);
  await tab.click();
  await page.waitForTimeout(400);
}

test('B24a running a built-in plugin edits the document in exactly one history entry', async ({
  page,
}) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 200, 120);

  /**
   * Layer names, read from the LAYERS panel with the Layers tab active.
   *
   * The Plugins panel REUSES `.layer-row__name` for its own plugin rows, so a
   * broad read while that tab is active returns PLUGIN names, not layers - which
   * is what made this look like the undo did nothing.
   */
  const layerNames = async () => {
    await page.locator('.rail__button[aria-label="Layers"]').click();
    await page.waitForTimeout(250);
    return page.locator('.app__left .layer-row__name').allTextContents();
  };

  // 1. Before: the drawn rectangle.
  const before = await layerNames();
  expect(before, `expected the drawn layer, saw ${JSON.stringify(before)}`).toContain('Rectangle 1');

  // 2. Run the plugin (scoped selector: `.app__left .section__body button` would
  //    resolve to the Pages section's guarded no-op "Delete page").
  await openPlugins(page);
  const runs = page.locator('.app__left [aria-label^="Run "]');
  await expect(runs.first()).toBeVisible();
  await runs.first().click();
  await page.waitForTimeout(900);

  // 3. It renamed the layer.
  const afterRun = await layerNames();
  expect(afterRun, `the plugin did not rename anything, saw ${JSON.stringify(afterRun)}`).toContain(
    'Layer 1',
  );
  expect(afterRun).not.toEqual(before);

  // 4. Exactly ONE history entry: a single Ctrl+Z restores the original name, and
  //    the three-way before/afterRun/afterUndo shape means this cannot pass
  //    vacuously.
  await page.keyboard.press('Control+z');
  await expect
    .poll(async () => (await layerNames()).join('|'), { timeout: 5000 })
    .toBe(before.join('|'));

  // 5. Redo re-applies the WHOLE run in one step, which is the real proof that
  //    the plugin landed exactly one history entry. (A second Ctrl+Z is NOT the
  //    check: it legitimately reverts the earlier draw, not half the plugin.)
  await page.keyboard.press('Control+Shift+z');
  await expect
    .poll(async () => (await layerNames()).join('|'), { timeout: 5000 })
    .toBe(afterRun.join('|'));
});

test('B24b Toggle dark theme changes the shell appearance', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 200, 120);

  const readTheme = () =>
    page.evaluate(() => {
      const app = document.querySelector('.app');
      const root = document.documentElement;
      return {
        appBg: app ? getComputedStyle(app).backgroundColor : null,
        attr: root.getAttribute('data-theme') ?? root.className,
        canvasBg: getComputedStyle(document.querySelector('.canvas')!).backgroundColor,
      };
    });

  const before = await readTheme();

  await openMenu(page);
  await page.locator('.menu__item', { hasText: 'Toggle dark theme' }).first().click();
  await page.waitForTimeout(500);

  const after = await readTheme();
  expect(after, `theme did not change: ${JSON.stringify({ before, after })}`).not.toEqual(before);

  // Toggling back restores the original appearance.
  await openMenu(page);
  await page.locator('.menu__item', { hasText: 'Toggle dark theme' }).first().click();
  await page.waitForTimeout(500);
  expect(await readTheme()).toEqual(before);

  // The selection edits still work in either theme.
  await page.locator('.rail__button[aria-label="Layers"]').click();
  await page.locator('.layer-row').last().click();
  expect(Number(await field(page, 'W').inputValue())).toBeGreaterThan(0);
});
