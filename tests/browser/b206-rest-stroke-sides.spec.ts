/**
 * A Figma REST file's per-side stroke weights survive the import: the stroked rectangle shows Per side on, with its four sides in the
 * panel. The conversion is unit-tested (tests/figma/stroke-sides.test.ts); this imports through the real menu and file chooser.
 */
import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { boot, docToScreen, field, nextPaint, openMenu } from './helpers';

/** The REST fixture with the stroked Card rectangle given per-side weights. The chooser takes the file as a buffer, so nothing is written. */
function restFileWithSides(): Buffer {
  const doc = JSON.parse(readFileSync('tests/figma/fixtures/rest-file.json', 'utf8'));
  const find = (node: { id: string; children?: unknown[] }): { id: string; individualStrokeWeights?: unknown } | undefined => {
    if (node.id === '1:4') return node as { id: string; individualStrokeWeights?: unknown };
    for (const child of (node.children ?? []) as Array<{ id: string; children?: unknown[] }>) {
      const found = find(child);
      if (found) return found;
    }
    return undefined;
  };
  find(doc.document)!.individualStrokeWeights = { top: 6, right: 1, bottom: 3, left: 2 };
  return Buffer.from(JSON.stringify(doc));
}

test('B206a a REST import keeps the per-side stroke weights of a stroked rectangle, and the panel shows them', async ({ page }: { page: Page }) => {
  await boot(page);
  await openMenu(page);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('.menu__item', { hasText: 'Import Figma JSON…' }).first().click(),
  ]);
  await chooser.setFiles({ name: 'rest-sides.json', mimeType: 'application/json', buffer: restFileWithSides() });
  await nextPaint(page);
  await expect(page.locator('.toast').first()).toContainText('Imported');

  // The Hero frame's children are collapsed in the layers list, so the Hero is entered and the Card picked on the canvas, at its centre.
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
  await expect(page.getByLabel('Individual stroke weights', { exact: true })).toBeChecked();
  await expect(field(page, 'Stroke top')).toHaveValue('6');
  await expect(field(page, 'Stroke right')).toHaveValue('1');
  await expect(field(page, 'Stroke bottom')).toHaveValue('3');
  await expect(field(page, 'Stroke left')).toHaveValue('2');
});
