/**
 * A Figma JSON layer's PNG export at a scale keeps its format, scale and suffix on import, and the export setting Pigma cannot write
 * (a PDF) is left out. The conversion is unit-tested (tests/figma/rest-export-settings.test.ts); this imports through the real menu and
 * file chooser, and reads the Export section of the panel.
 */
import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { boot, docToScreen, nextPaint, openMenu } from './helpers';

/** The REST fixture with the Card exported as a 2x PNG with the suffix @2x, and as a PDF Pigma cannot write. */
function restFileWithExports(): Buffer {
  const doc = JSON.parse(readFileSync('tests/figma/fixtures/rest-file.json', 'utf8'));
  const walk = (node: any) => {
    if (node.id === '1:4') {
      node.exportSettings = [
        { suffix: '@2x', format: 'PNG', constraint: { type: 'SCALE', value: 2 } },
        { suffix: '', format: 'PDF', constraint: { type: 'SCALE', value: 1 } },
      ];
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(doc.document);
  return Buffer.from(JSON.stringify(doc));
}

test('B210a a REST layer\'s PNG export keeps its scale and suffix, and a PDF setting is left out', async ({ page }: { page: Page }) => {
  await boot(page);
  await openMenu(page);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('.menu__item', { hasText: 'Import Figma JSON…' }).first().click(),
  ]);
  await chooser.setFiles({ name: 'rest-exports.json', mimeType: 'application/json', buffer: restFileWithExports() });
  await nextPaint(page);
  await expect(page.locator('.toast').first()).toContainText('Imported');

  // The Hero is entered so its Card can be picked on the canvas, at its centre.
  const centre = await page.evaluate(() => {
    const kids = window.__pigmaStore!.getState().file.document.children[0]!.children as any[];
    const hero = kids.find((node) => node.name === 'Hero');
    window.__pigmaStore!.getState().setEnteredContainer(hero.id);
    const card = hero.children.find((node: any) => node.name === 'Card');
    return {
      x: hero.transform.tx + card.transform.tx + card.width / 2,
      y: hero.transform.ty + card.transform.ty + card.height / 2,
    };
  });
  const point = await docToScreen(page, centre.x, centre.y);
  await page.mouse.click(point.x, point.y);
  await nextPaint(page);

  // Only the PNG is left: one export row, at the scale and with the suffix it was exported with.
  await expect(page.getByLabel('Export format')).toHaveCount(1);
  await expect(page.getByLabel('Export format')).toHaveValue('PNG');
  await expect(page.getByLabel('Export scale')).toHaveValue('2');
  await expect(page.getByLabel('Export suffix')).toHaveValue('@2x');
});
