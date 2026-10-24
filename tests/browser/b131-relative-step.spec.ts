/**
 * A step on a mixed field moves every selected layer by the same amount, so layers that differ keep their gap. The
 * arrow keys and the scrub send relative steps when a field is mixed; typing still sets one value on every layer (B126b).
 * The store action is stepSelected; this drives the live panel.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, field, nextPaint } from './helpers';

/** Rectangle 1 at 40% opacity and Rectangle 2 at 60%, both selected. */
async function twoOpacities(page: Page) {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 120, 90, -120, 0);
  await field(page, 'Opacity').fill('40');
  await field(page, 'Opacity').press('Enter');
  await drawShape(page, 'Rectangle', 120, 90, 120, 0);
  await field(page, 'Opacity').fill('60');
  await field(page, 'Opacity').press('Enter');
  await page.keyboard.press('Control+A');
  await expect(page.getByText('2 layers selected')).toBeVisible();
}

test('B131a an arrow step on a mixed opacity moves each layer by one point and keeps the field mixed', async ({ page }) => {
  await twoOpacities(page);
  const opacity = field(page, 'Opacity');
  await expect(opacity).toHaveAttribute('placeholder', '—');
  await opacity.focus();
  await page.keyboard.press('ArrowUp');
  await nextPaint(page);
  await expect(opacity, 'the step made the layers equal, or the field lost its mixed state').toHaveAttribute('placeholder', '—');
});

test('B131b each layer kept its own value after the step: 41 and 61, not one shared value', async ({ page }) => {
  await twoOpacities(page);
  await field(page, 'Opacity').focus();
  await page.keyboard.press('ArrowUp');
  await nextPaint(page);

  await page.locator('.layer-row', { hasText: 'Rectangle 1' }).first().click();
  await nextPaint(page);
  await expect(field(page, 'Opacity')).toHaveValue('41');
  await page.locator('.layer-row', { hasText: 'Rectangle 2' }).first().click();
  await nextPaint(page);
  await expect(field(page, 'Opacity')).toHaveValue('61');
});

test('B131c a scrub on a mixed opacity moves each layer by the same drag, from its own value', async ({ page }) => {
  await twoOpacities(page);
  const chrome = page.locator('label.input--scrub', { has: page.locator('input[aria-label="Opacity"]') });
  const box = (await chrome.boundingBox())!;
  // Grab the label chrome, not the input, and drag 10px to the right.
  const startX = box.x + 6;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 10, startY, { steps: 5 });
  await page.mouse.up();
  await nextPaint(page);

  await page.locator('.layer-row', { hasText: 'Rectangle 1' }).first().click();
  await nextPaint(page);
  const first = Number(await field(page, 'Opacity').inputValue());
  await page.locator('.layer-row', { hasText: 'Rectangle 2' }).first().click();
  await nextPaint(page);
  const second = Number(await field(page, 'Opacity').inputValue());
  // Each layer gained the same ten points from its own starting value.
  expect(first, 'the first layer did not move by the drag').toBeCloseTo(50, 0);
  expect(second, 'the second layer did not move by the drag from its own value').toBeCloseTo(70, 0);
});
