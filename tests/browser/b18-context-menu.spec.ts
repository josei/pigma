/**
 * The canvas context menu: a POSITIONED instance of the existing menu surface,
 * backed only by existing store actions. The documented/diverged split is in the
 * component's header; these specs assert behaviour, not shape.
 */
import { test, expect } from '@playwright/test';
import { boot, drawShape } from './helpers';

const menu = '[data-testid="context-menu"]';

test('right-click on a selected node opens the node menu, and one item is one undo entry', async ({ page }) => {
  await boot(page);
  await drawShape(page, 'Rectangle', 200, 120);
  await drawShape(page, 'Rectangle', 240, 160);

  const canvas = page.locator('.canvas').first();
  await canvas.click({ button: 'right', position: { x: 300, y: 200 } });
  await expect(page.locator(menu), 'no menu on right-click').toHaveCount(1);
  await expect(page.locator(menu)).toHaveAttribute('data-selection', 'node');
  await expect(page.locator(`${menu} [data-testid="context-menu-item"]`)).not.toHaveCount(0);

  // A plain LEFT click must not open it.
  await page.keyboard.press('Escape');
  await expect(page.locator(menu)).toHaveCount(0);
  await canvas.click({ position: { x: 320, y: 220 } });
  await expect(page.locator(menu), 'a left click opened the context menu').toHaveCount(0);

  // BOTH shapes selected — `drawShape` leaves only the last one selected, and
  // grouping one node is correctly a no-op.
  await page.keyboard.press('Control+a');
  // The starter document has several layers; what matters is MORE THAN ONE, so
  // grouping is a real operation rather than a no-op.
  expect(await page.locator('.layer-row--selected').count()).toBeGreaterThan(1);

  // Group the selection: the DOCUMENT changes, in exactly ONE undo entry.
  await canvas.click({ button: 'right', position: { x: 300, y: 200 } });
  await page.locator(`${menu} [data-testid="context-menu-item"]`, { hasText: 'Group selection' }).click();
  await expect(page.locator(menu), 'the menu stayed open after a click').toHaveCount(0);
  await expect(page.locator('.layer-row').filter({ hasText: /^Group/ }), 'no group was created').toHaveCount(1);

  // ONE undo entry: undo once and the group is gone (and the two shapes are back).
  await page.keyboard.press('Control+z');
  await expect(page.locator('.layer-row').filter({ hasText: /^Group/ }), 'undo did not reverse the group').toHaveCount(0);
});

test('right-click with nothing selected opens the empty-selection menu', async ({ page }) => {
  await boot(page);
  const canvas = page.locator('.canvas').first();
  await canvas.click({ button: 'right', position: { x: 400, y: 300 } });
  await expect(page.locator(menu)).toHaveCount(1);
  await expect(page.locator(menu)).toHaveAttribute('data-selection', 'empty');
  const labels = await page.locator(`${menu} [data-testid="context-menu-item"]`).allInnerTexts();
  expect(labels.join('|')).toContain('Select all');
  expect(labels.join('|'), 'the node menu appeared for an empty selection').not.toContain('Use as mask');
});

test('right-click over a panel opens no canvas menu', async ({ page }) => {
  await boot(page);
  await page.locator('.left-panel, .panel--left, [class*="left"]').first().click({ button: 'right', position: { x: 20, y: 20 } }).catch(() => {});
  await expect(page.locator(menu), 'the canvas menu opened over a panel').toHaveCount(0);
});
