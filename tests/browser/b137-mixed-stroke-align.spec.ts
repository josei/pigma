/**
 * The stroke Align segmented control for a selection of several layers with strokes: when the layers' alignments differ,
 * no option is highlighted and the group says Mixed; a click sets every selected layer. The comparison is the isMixedValue
 * check the other fields use, over the alignment each layer displays. This drives the live panel.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, nextPaint, tool } from './helpers';

const group = (page: Page) => page.locator('.segmented[aria-label="Align"]');
const active = (page: Page) => group(page).locator('.segmented__option--active');

/** A rectangle with a stroke whose alignment is set by clicking one option, or left unset when no option is given. */
async function strokedRectangle(page: Page, x: number, option?: string) {
  await drawShape(page, 'Rectangle', 120, 90, x, 0);
  await page.getByRole('button', { name: 'Add Stroke' }).click();
  if (option) {
    await group(page).locator('.segmented__option', { hasText: option }).click();
    await nextPaint(page);
  }
}

async function selectBoth(page: Page) {
  await tool(page, 'Move').click();
  await page.keyboard.press('Control+A');
  await expect(page.getByText('2 layers selected')).toBeVisible();
}

test('B137a strokes with different alignments show no active option and say Mixed', async ({ page }) => {
  await boot(page, { blank: true });
  await strokedRectangle(page, -120, 'In');
  await strokedRectangle(page, 120, 'Out');
  await selectBoth(page);
  await expect(group(page)).toHaveAttribute('data-mixed', 'true');
  await expect(group(page)).toHaveAttribute('title', 'Mixed');
  await expect(active(page)).toHaveCount(0);
});

test('B137b a click on a mixed stroke alignment sets every selected layer, so the group reads one value again', async ({ page }) => {
  await boot(page, { blank: true });
  await strokedRectangle(page, -120, 'In');
  await strokedRectangle(page, 120, 'Out');
  await selectBoth(page);
  await expect(group(page)).toHaveAttribute('data-mixed', 'true');
  await group(page).locator('.segmented__option', { hasText: 'Mid' }).click();
  await nextPaint(page);
  await expect(group(page)).not.toHaveAttribute('data-mixed', 'true');
  await expect(active(page)).toHaveText('Mid');
  // The first layer, selected alone, now holds Mid too.
  await page.locator('.layer-row', { hasText: 'Rectangle 1' }).first().click();
  await nextPaint(page);
  await expect(active(page)).toHaveText('Mid');
});

test('B137c layers that share an alignment are not mixed, and that option stays highlighted', async ({ page }) => {
  await boot(page, { blank: true });
  await strokedRectangle(page, -120, 'Out');
  await strokedRectangle(page, 120, 'Out');
  await selectBoth(page);
  await expect(group(page)).not.toHaveAttribute('data-mixed', 'true');
  await expect(group(page)).not.toHaveAttribute('title', 'Mixed');
  await expect(active(page)).toHaveText('Out');
});
