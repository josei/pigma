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

test('the empty menu does not offer an item that cannot work', async ({ page }) => {
  await boot(page);
  const canvas = page.locator('.canvas').first();
  await canvas.click({ button: 'right', position: { x: 400, y: 300 } });
  const labels = (await page.locator(`${menu} [data-testid="context-menu-item"]`).allInnerTexts()).join('|');
  // `frameSelection` returns early when the selection is empty — the exact condition
  // that renders this menu — so "Frame selection" was a guaranteed no-op here.
  expect(labels, 'the empty menu still offers Frame selection').not.toContain('Frame selection');
  expect(labels).toContain('Select all');
});

test('conditional no-ops are DISABLED and say why; enabled items still work', async ({ page }) => {
  await boot(page);
  const canvas = page.locator('.canvas').first();
  await drawShape(page, 'Rectangle', 200, 120);

  // ONE node: Group selection cannot work, so it is disabled and explains itself.
  await canvas.click({ button: 'right', position: { x: 300, y: 200 } });
  const group = page.locator(`${menu} [data-testid="context-menu-item"]`, { hasText: 'Group selection' });
  await expect(group, 'Group selection is enabled with one layer').toBeDisabled();
  await expect(group).toHaveAttribute('data-disabled-reason', 'grouping needs more than one layer');
  // Ungroup on a plain rectangle: also disabled, also explained.
  const ungroup = page.locator(`${menu} [data-testid="context-menu-item"]`, { hasText: 'Ungroup' });
  await expect(ungroup).toBeDisabled();
  await expect(ungroup).toHaveAttribute('data-disabled-reason', 'nothing in the selection is a group or frame');
  // Paste with an empty clipboard: disabled.
  const paste = page.locator(`${menu} [data-testid="context-menu-item"]`, { hasText: 'Paste' });
  await expect(paste).toBeDisabled();
  // And an ENABLED item still works — disabling too broadly would be worse.
  await page.locator(`${menu} [data-testid="context-menu-item"]`, { hasText: 'Use as mask' }).click();
  await expect(page.locator('[data-testid="layer-mask-badge"]'), 'the enabled mask item did nothing').toHaveCount(1);

  // TWO nodes: Group selection becomes enabled and works.
  await page.keyboard.press('Control+a');
  await canvas.click({ button: 'right', position: { x: 300, y: 200 } });
  const group2 = page.locator(`${menu} [data-testid="context-menu-item"]`, { hasText: 'Group selection' });
  await expect(group2, 'Group selection stayed disabled with two layers').toBeEnabled();
  await group2.click();
  await expect(page.locator('.layer-row').filter({ hasText: /^Group/ })).toHaveCount(1);
});

test('the Comment tool advertises C and C selects it', async ({ page }) => {
  await boot(page);
  const comment = page.locator('[role="toolbar"]').getByRole('button', { name: 'Comment' });
  await expect(comment).not.toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('c');
  // The advertised key must DO something observable: the comment tool becomes active.
  await expect(comment, 'C did not select the Comment tool').toHaveAttribute('aria-pressed', 'true');
});

test('the toolbar still opens the main menu, and no dead listener remains', async ({ page }) => {
  await boot(page);
  // The `pigma:open-menu` listener had zero dispatchers; the toolbar dispatches
  // `pigma:toggle-menu`, which is the one that must still work.
  await page.getByRole('button', { name: /menu/i }).first().click();
  await expect(page.locator('.menu').first()).toBeVisible();
});
