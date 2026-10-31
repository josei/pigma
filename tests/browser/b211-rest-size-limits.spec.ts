/**
 * A Figma JSON frame keeps its size limits on import: the Hero's minimum width and maximum height show in the Size limits section of
 * the panel. The conversion is unit-tested (tests/figma/rest-size-limits.test.ts); this imports through the real menu and file chooser.
 */
import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { boot, field, nextPaint, openMenu } from './helpers';

/** The REST fixture with the Hero frame given a minimum width of 320 and a maximum height of 600. */
function restFileWithLimits(): Buffer {
  const doc = JSON.parse(readFileSync('tests/figma/fixtures/rest-file.json', 'utf8'));
  const walk = (node: any) => {
    if (node.id === '1:2') Object.assign(node, { minWidth: 320, maxHeight: 600 });
    for (const child of node.children ?? []) walk(child);
  };
  walk(doc.document);
  return Buffer.from(JSON.stringify(doc));
}

test('B211a a REST frame keeps its minimum width and maximum height, shown in the Size limits section', async ({ page }: { page: Page }) => {
  await boot(page);
  await openMenu(page);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('.menu__item', { hasText: 'Import Figma JSON…' }).first().click(),
  ]);
  await chooser.setFiles({ name: 'rest-limits.json', mimeType: 'application/json', buffer: restFileWithLimits() });
  await nextPaint(page);
  await expect(page.locator('.toast').first()).toContainText('Imported');

  // The Hero is a top-level frame, so selecting it from the layers list shows its limits.
  await page.locator('.layer-row', { hasText: 'Hero' }).first().click();
  await nextPaint(page);
  await expect(field(page, 'Min W')).toHaveValue('320');
  await expect(field(page, 'Max H')).toHaveValue('600');
});
