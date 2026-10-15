import { test, expect } from '@playwright/test';
import { boot, tool } from './helpers';

/** A text layer takes its name from its words until someone renames it. */
test('B64a a new text layer is named after what is typed', async ({ page }) => {
  await boot(page, { blank: true });
  await page.keyboard.press('t');
  await page.mouse.click(400, 300);
  await page.keyboard.type('Designer text');
  await page.keyboard.press('Escape');
  await tool(page, 'Move').click();
  await page.locator('.rail__button[aria-label="Layers"]').click();
  await expect(page.locator('.layer-row__name', { hasText: 'Designer text' }).first()).toBeVisible();
});

test('B64b a text layer renamed by hand keeps its name when the words change', async ({ page }) => {
  await boot(page, { blank: true });
  await page.keyboard.press('t');
  await page.mouse.click(400, 300);
  await page.keyboard.type('Heading');
  await page.keyboard.press('Escape');
  await tool(page, 'Move').click();
  await page.locator('.rail__button[aria-label="Layers"]').click();
  await page.evaluate(() => {
    const s = window.__pigmaStore!.getState();
    const id = s.file.document.children[0]!.children[0]!.id;
    s.select([id]);
    s.updateSelected({ name: 'Hero title' }, 'Rename');
    s.setCharacters(id, 'Something else');
  });
  await expect(page.locator('.layer-row__name', { hasText: 'Hero title' }).first()).toBeVisible();
});
