/**
 * The alignment and sizing segmented controls for a selection of several auto layout frames: when the frames differ, no
 * option is highlighted and the group says Mixed; a click sets every selected frame. The comparison is the same isMixedValue
 * check the number fields use; the sizing axes are compared on the field each frame stores them in. This drives the live panel.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, nextPaint } from './helpers';

async function rowFrame(page: Page, x: number) {
  await drawShape(page, 'Frame', 160, 120, x, 0);
  const autoLayout = page.locator('.section', { has: page.locator('.section__header', { hasText: 'Auto layout' }) });
  await autoLayout.locator('.segmented__option', { hasText: 'Row' }).click();
  await nextPaint(page);
}

const group = (page: Page, label: string) => page.locator(`.segmented[aria-label="${label}"]`);
const active = (page: Page, label: string) => group(page, label).locator('.segmented__option--active');

test('B135a frames with different alignments show no active option and say Mixed', async ({ page }) => {
  await boot(page, { blank: true });
  await rowFrame(page, -120);
  await rowFrame(page, 120);
  await group(page, 'Alignment').locator('.segmented__option', { hasText: 'Center' }).click();
  await nextPaint(page);
  await page.keyboard.press('Control+A');
  await expect(page.getByText('2 layers selected')).toBeVisible();
  await expect(group(page, 'Alignment')).toHaveAttribute('data-mixed', 'true');
  await expect(group(page, 'Alignment')).toHaveAttribute('title', 'Mixed');
  await expect(active(page, 'Alignment')).toHaveCount(0);
});

test('B135b a click on an alignment sets every selected frame, so the group reads one value again', async ({ page }) => {
  await boot(page, { blank: true });
  await rowFrame(page, -120);
  await rowFrame(page, 120);
  await group(page, 'Alignment').locator('.segmented__option', { hasText: 'Center' }).click();
  await nextPaint(page);
  await page.keyboard.press('Control+A');
  await expect(group(page, 'Alignment')).toHaveAttribute('data-mixed', 'true');
  await group(page, 'Alignment').locator('.segmented__option', { hasText: 'End' }).click();
  await nextPaint(page);
  await expect(group(page, 'Alignment')).not.toHaveAttribute('data-mixed', 'true');
  await expect(active(page, 'Alignment')).toHaveText('End');
  // The first frame, selected alone, now holds End too.
  await page.locator('.layer-row', { hasText: 'Frame 1' }).first().click();
  await nextPaint(page);
  await expect(active(page, 'Alignment')).toHaveText('End');
});

test('B135c frames with different widths show Mixed in the Width sizing, and a click sets them all', async ({ page }) => {
  await boot(page, { blank: true });
  await rowFrame(page, -120);
  await rowFrame(page, 120);
  // The second frame's width is Fixed; the first stays Hug.
  await group(page, 'Width').locator('.segmented__option', { hasText: 'Fixed' }).click();
  await nextPaint(page);
  await page.keyboard.press('Control+A');
  await expect(group(page, 'Width')).toHaveAttribute('data-mixed', 'true');
  await expect(active(page, 'Width')).toHaveCount(0);
  await group(page, 'Width').locator('.segmented__option', { hasText: 'Fixed' }).click();
  await nextPaint(page);
  await expect(group(page, 'Width')).not.toHaveAttribute('data-mixed', 'true');
  await expect(active(page, 'Width')).toHaveText('Fixed');
});
