/**
 * The Gap, Line gap and padding fields for a selection of several auto layout frames: when the frames share a value the field
 * shows it, and when they differ it is empty, shows a dash and says "Mixed". Typing sets every selected frame. The rule is
 * the isMixedValue check used by the other fields; this drives the live panel.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, field, nextPaint } from './helpers';

/** A frame with auto layout in a row. The auto layout section is the one with that header. */
async function rowFrame(page: Page, x: number) {
  await drawShape(page, 'Frame', 160, 120, x, 0);
  const autoLayout = page.locator('.section', { has: page.locator('.section__header', { hasText: 'Auto layout' }) });
  await autoLayout.locator('.segmented__option', { hasText: 'Row' }).click();
  await nextPaint(page);
}

/** Two frames in a row: the first at the default gap (12) and top padding (16); the second at a gap of 30 and top padding 40. */
async function twoFrames(page: Page) {
  await boot(page, { blank: true });
  await rowFrame(page, -120);
  await rowFrame(page, 120);
  await field(page, 'Gap').fill('30');
  await field(page, 'Gap').press('Enter');
  await field(page, 'Pad T').fill('40');
  await field(page, 'Pad T').press('Enter');
  await nextPaint(page);
  await page.keyboard.press('Control+A');
  await expect(page.getByText('2 layers selected')).toBeVisible();
}

test('B134a frames with different gaps and top padding show Mixed, with a dash and a tooltip', async ({ page }) => {
  await twoFrames(page);
  for (const label of ['Gap', 'Pad T']) {
    await expect(field(page, label), label).toHaveValue('');
    await expect(field(page, label), label).toHaveAttribute('placeholder', '—');
    await expect(field(page, label), label).toHaveAttribute('title', 'Mixed');
  }
  // Pad R is 16 on both frames, so it is not mixed.
  await expect(field(page, 'Pad R')).toHaveValue('16');
});

test('B134b typing a gap sets every selected frame, so the field shows it with no Mixed state', async ({ page }) => {
  await twoFrames(page);
  const gap = field(page, 'Gap');
  await gap.fill('20');
  await gap.press('Enter');
  await nextPaint(page);
  await expect(gap).toHaveValue('20');
  await expect(gap).not.toHaveAttribute('title', 'Mixed');
  // Each frame now carries the gap: select the second one alone to check it.
  await page.locator('.layer-row', { hasText: 'Frame 1' }).first().click();
  await nextPaint(page);
  await expect(field(page, 'Gap')).toHaveValue('20');
});
