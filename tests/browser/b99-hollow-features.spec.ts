/**
 * Features that looked present and did nothing (docs/ROADMAP.md, "a feature that is
 * present and does nothing"). Each one is driven and its result measured, so a
 * regression puts a control back in the menu or the key table that does nothing.
 */
import { test, expect } from '@playwright/test';
import { boot, drawShape, tool } from './helpers';

const menu = '[data-testid="context-menu"]';
const item = (label: string) => `${menu} [data-testid="context-menu-item"]`;

test('B99a the empty-selection menu offers no Frame selection, which needs a selection', async ({ page }) => {
  await boot(page);
  await page.locator('.canvas').first().click({ button: 'right', position: { x: 400, y: 300 } });
  await expect(page.locator(menu)).toHaveAttribute('data-selection', 'empty');
  const labels = await page.locator(item('')).allInnerTexts();
  expect(labels.join('|')).not.toContain('Frame selection');
});

test('B99b Group selection is disabled with one layer, and says why', async ({ page }) => {
  await boot(page);
  await drawShape(page, 'Rectangle', 200, 120);
  await page.locator('.canvas').first().click({ button: 'right', position: { x: 300, y: 200 } });
  const group = page.locator(item(''), { hasText: 'Group selection' });
  await expect(group).toHaveAttribute('data-disabled-reason', 'grouping needs more than one layer');
  await expect(group).toBeDisabled();
});

test('B99c Ungroup is disabled on a plain shape, and says why', async ({ page }) => {
  await boot(page);
  await drawShape(page, 'Rectangle', 200, 120);
  await page.locator('.canvas').first().click({ button: 'right', position: { x: 300, y: 200 } });
  const ungroup = page.locator(item(''), { hasText: 'Ungroup' });
  await expect(ungroup).toHaveAttribute('data-disabled-reason', 'nothing in the selection is a group or frame');
  await expect(ungroup).toBeDisabled();
});

test('B99d Paste is disabled while the clipboard is empty, and says why', async ({ page }) => {
  await boot(page);
  await drawShape(page, 'Rectangle', 200, 120);
  await page.locator('.canvas').first().click({ button: 'right', position: { x: 300, y: 200 } });
  const paste = page.locator(item(''), { hasText: 'Paste' }).first();
  await expect(paste).toHaveAttribute('data-disabled-reason', 'the clipboard is empty');
  await expect(paste).toBeDisabled();
});

test('B99e the C key selects the Comment tool, as the toolbar advertises', async ({ page }) => {
  await boot(page);
  await page.locator('.canvas').first().click({ position: { x: 300, y: 300 } });
  await page.keyboard.press('c');
  await expect(tool(page, 'Comment')).toHaveAttribute('aria-pressed', 'true');
});
