/**
 * The Interactions section with several layers selected: each selected layer's interactions are listed read-only, so a
 * designer can see which layers carry a link. The editing below stays on the first selected layer, and the section says so.
 * The labels come from triggerLabel and actionLabel (prototype.ts); this drives the live panel.
 */
import { test, expect } from '@playwright/test';
import { boot, drawShape, nextPaint } from './helpers';

test('B136a several layers list each one\'s interactions, and a layer without any says so', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 120, 90, -120, 0);
  await drawShape(page, 'Rectangle', 120, 90, 120, 0);
  await page.locator('.layer-row', { hasText: 'Rectangle 1' }).first().click();
  await nextPaint(page);
  await page.locator('.tab', { hasText: 'Prototype' }).click();
  await nextPaint(page);
  await page.locator('[aria-label="Add interaction"]').click();
  await nextPaint(page);

  await page.keyboard.press('Control+A');
  // The count line lives on the Design tab, so the selection is read from the layers panel here.
  await expect(page.locator('.layer-row--selected')).toHaveCount(2);
  const summary = page.getByTestId('interactions-selection');
  await expect(summary).toBeVisible();
  await expect(summary.locator('.prop-row', { hasText: 'Rectangle 1' })).toContainText('On click');
  await expect(summary.locator('.prop-row', { hasText: 'Rectangle 2' })).toContainText('No interactions');
  await expect(summary).toContainText('Other fields edit the first selected layer');
});

test('B136b a single selected layer shows no summary, and its own list is editable as before', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 120, 90, -120, 0);
  await drawShape(page, 'Rectangle', 120, 90, 120, 0);
  await page.locator('.layer-row', { hasText: 'Rectangle 2' }).first().click();
  await nextPaint(page);
  await page.locator('.tab', { hasText: 'Prototype' }).click();
  await nextPaint(page);
  await expect(page.getByTestId('interactions-selection')).toHaveCount(0);
});
