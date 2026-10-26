/**
 * The Family select shows the chosen family in its own typeface, and each option carries its family. Penpot 2.18 shows
 * each family name in its own typeface in its font selector. Here the closed control always can, since the platform
 * draws it with the element's own font; an open list follows where the platform draws option styles (a native popup on
 * macOS may not). The rule is in PropertiesPanel's TextSection; this drives the live editor.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, nextPaint, tool } from './helpers';

/** One text layer with the word Hello, selected. */
async function textNode(page: Page) {
  await tool(page, 'Text').click();
  const box = (await page.locator('.canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 + 200, box.y + box.height / 2 - 120);
  await nextPaint(page);
  await page.keyboard.type('Hello');
  await page.keyboard.press('Escape');
  await nextPaint(page);
}

test('B161a the Family select shows the chosen family in its own typeface, and each option carries its family', async ({ page }) => {
  await boot(page, { blank: true });
  await textNode(page);
  const family = page.locator('select[aria-label="Font family"]');
  await family.selectOption('Georgia');
  await nextPaint(page);

  // The closed control draws its text in the family it names.
  await expect.poll(() => family.evaluate((element) => getComputedStyle(element).fontFamily)).toContain('Georgia');
  // Each option names its own family, so a platform that styles options draws each name in its typeface.
  // The browser quotes a multi-word family ("Courier New"); the family is the same, so the quotes are dropped.
  const optionFamilies = await family.evaluate((element) =>
    Array.from((element as HTMLSelectElement).options).map((option) => [option.value, option.style.fontFamily.replace(/"/g, '')]),
  );
  expect(optionFamilies).toContainEqual(['Georgia', 'Georgia']);
  expect(optionFamilies).toContainEqual(['Courier New', 'Courier New']);
});
