import { test, expect } from '@playwright/test';
import { boot, drawShape, tool } from './helpers';

test('B14a presentation without a start frame shows the fallback view', async ({ page }) => {
  await boot(page, { blank: true });
  await tool(page, 'Present').click();
  await page.waitForTimeout(500);

  await expect(page.locator('.present')).toHaveCount(1);
  await expect(page.locator('.present__toolbar')).toContainText('Close');
  // No start frame means no stage to show.
  await expect(page.locator('.present__stage')).toHaveCount(0);

  await page.locator('.present__toolbar .button').click();
  await expect(page.locator('.present')).toHaveCount(0);
});

test('B14b a start frame gives presentation a real stage', async ({ page }) => {
  await boot(page);
  await page.locator('button[aria-label="Add page"]').click();
  await drawShape(page, 'Frame', 320, 240);
  const frame = (await page.locator('.layer-row--selected .layer-row__name').first().textContent())!;

  await page.locator('.tab', { hasText: 'Prototype' }).click();
  const startFrame = page.locator('select[aria-label="Prototype start frame"]');
  await expect(startFrame).toBeVisible();
  await startFrame.selectOption({ label: frame });
  await page.waitForTimeout(250);

  await tool(page, 'Present').click();
  await page.waitForTimeout(500);

  await expect(page.locator('.present__stage')).toHaveCount(1);
  await expect(page.locator('.present__frame')).toHaveCount(1);
  await expect(page.locator('.present__toolbar')).toContainText('Close');
});

// Prototype setup drives several selects and a presentation round trip.
test.describe.configure({ timeout: 90_000 });

test('B14c an On-click link becomes a hotspot and navigates', async ({ page }) => {
  await boot(page);
  await page.locator('button[aria-label="Add page"]').click();

  // Two frames: the start frame and a destination.
  await drawShape(page, 'Frame', 300, 220, -260, 0);
  const source = (await page.locator('.layer-row--selected .layer-row__name').first().textContent())!;
  await drawShape(page, 'Frame', 300, 220, 260, 0);
  const target = (await page.locator('.layer-row--selected .layer-row__name').first().textContent())!;

  // A clickable shape inside the source frame.
  await drawShape(page, 'Rectangle', 120, 80, -260, 0);
  const hotspot = (await page.locator('.layer-row--selected .layer-row__name').first().textContent())!;

  await page.locator('.tab', { hasText: 'Prototype' }).click();
  await page.locator('select[aria-label="Prototype start frame"]').selectOption({ label: source });
  // The destination list is built asynchronously; wait for the target option
  // rather than racing selectOption against an empty list.
  const destination = page.locator('select[aria-label="Navigate to"]');
  await expect(destination.locator('option', { hasText: target })).toHaveCount(1, { timeout: 15000 });
  await destination.selectOption({ label: target });
  await page.locator('.button', { hasText: 'Apply link' }).click();
  await page.waitForTimeout(300);

  await tool(page, 'Present').click();
  await page.waitForTimeout(500);

  const spot = page.locator('.present__hotspot');
  await expect(spot).toHaveCount(1);
  await expect(spot).toHaveAttribute('aria-label', new RegExp(hotspot));

  // The toolbar shows the presented frame's name; both frames are the same size
  // so the frame's inline style is not a reliable navigation signal.
  const presented = page.locator('.present__toolbar span');
  await expect(presented).toHaveText(source);

  await spot.click();
  await expect(presented).toHaveText(target);
});
