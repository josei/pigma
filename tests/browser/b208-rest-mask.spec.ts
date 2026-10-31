/**
 * A Figma REST layer used as a mask stays a mask on import, with its mask type: the mask is marked in the layers list, and the panel
 * shows the type it imported with. The conversion is unit-tested (tests/figma/rest-mask.test.ts); this imports through the real menu
 * and file chooser.
 */
import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { boot, docToScreen, nextPaint, openMenu } from './helpers';

/** The REST fixture with the Card rectangle used as a luminance mask. The chooser takes the file as a buffer, so nothing is written. */
function restFileWithMask(): Buffer {
  const doc = JSON.parse(readFileSync('tests/figma/fixtures/rest-file.json', 'utf8'));
  const find = (node: { id: string; children?: unknown[] }): Record<string, unknown> | undefined => {
    if (node.id === '1:4') return node as Record<string, unknown>;
    for (const child of (node.children ?? []) as Array<{ id: string; children?: unknown[] }>) {
      const found = find(child);
      if (found) return found;
    }
    return undefined;
  };
  Object.assign(find(doc.document)!, { isMask: true, maskType: 'LUMINANCE' });
  return Buffer.from(JSON.stringify(doc));
}

test('B208a a REST layer used as a mask imports as a mask, with its mask type shown in the panel', async ({ page }: { page: Page }) => {
  await boot(page);
  await openMenu(page);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('.menu__item', { hasText: 'Import Figma JSON…' }).first().click(),
  ]);
  await chooser.setFiles({ name: 'rest-mask.json', mimeType: 'application/json', buffer: restFileWithMask() });
  await nextPaint(page);
  await expect(page.locator('.toast').first()).toContainText('Imported');

  // The Hero is entered so its Card can be picked on the canvas, at its centre.
  const centre = await page.evaluate(() => {
    const kids = window.__pigmaStore!.getState().file.document.children[0]!.children as any[];
    const hero = kids.find((node) => node.name === 'Hero');
    window.__pigmaStore!.getState().setEnteredContainer(hero.id);
    const card = hero.children.find((node: any) => node.name === 'Card');
    return {
      isMask: card.isMask as boolean,
      maskType: card.maskType as string,
      x: hero.transform.tx + card.transform.tx + card.width / 2,
      y: hero.transform.ty + card.transform.ty + card.height / 2,
    };
  });
  expect(centre.isMask).toBe(true);
  expect(centre.maskType).toBe('LUMINANCE');

  const point = await docToScreen(page, centre.x, centre.y);
  await page.mouse.click(point.x, point.y);
  await nextPaint(page);
  await expect(page.getByLabel('Mask type', { exact: true })).toHaveValue('LUMINANCE');
});
