/**
 * A ruler guide is selected by pressing it, and Delete removes the selected guide (Figma: "select the guide and press
 * Delete"). Selecting a layer clears the guide selection. The state is in the store; this drives the live canvas.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, canvasBox, drawShape } from './helpers';

/** Press the guide at a point on its line. A stroke-only line is not a clickable box for Playwright, so use the pointer. */
async function pressGuide(page: Page) {
  const box = await canvasBox(page);
  const line = page.locator('[data-testid="guide-line"]').first();
  const y = Number(await line.getAttribute('y1')) + box.y;
  await page.mouse.click(box.x + 400, y);
}

async function horizontalGuide(page: Page) {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 80, 60, -200, 0);
  const box = await canvasBox(page);
  await page.mouse.move(box.x + 200, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 200, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('[data-testid="guide-line"]')).toHaveCount(1);
}

test('B117a pressing a guide selects it, and Delete removes the selected guide', async ({ page }) => {
  await horizontalGuide(page);
  await pressGuide(page);
  await expect(page.locator('[data-testid="guide-line"][data-selected="true"]')).toHaveCount(1);

  await page.keyboard.press('Delete');
  await expect(page.locator('[data-testid="guide-line"]')).toHaveCount(0);
});

test('B117b selecting a layer clears the guide selection, so Delete then removes the layer and not the guide', async ({ page }) => {
  await horizontalGuide(page);
  await pressGuide(page);
  await expect(page.locator('[data-testid="guide-line"][data-selected="true"]')).toHaveCount(1);

  await page.locator('.layer-row', { hasText: 'Rectangle 1' }).first().click();
  await expect(page.locator('[data-testid="guide-line"][data-selected="true"]')).toHaveCount(0);
  await page.keyboard.press('Delete');
  await expect(page.locator('[data-testid="guide-line"]')).toHaveCount(1);
  await expect(page.locator('.layer-row', { hasText: 'Rectangle 1' })).toHaveCount(0);
});

test('B117c right-clicking a guide removes it, as Figma\'s guide menu does', async ({ page }) => {
  await horizontalGuide(page);
  const box = await canvasBox(page);
  const line = page.locator('[data-testid="guide-line"]').first();
  const y = Number(await line.getAttribute('y1')) + box.y;
  await page.mouse.click(box.x + 400, y, { button: 'right' });
  await expect(page.locator('[data-testid="guide-line"]')).toHaveCount(0);
});
