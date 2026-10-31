/**
 * A Figma JSON import keeps a top-level frame's Dev Mode status: the Hero frame shows its "Ready" badge in the layers list, and a
 * layer's component property references are kept in the model. The conversion is unit-tested (tests/figma/rest-handoff.test.ts);
 * this imports through the real menu and file chooser.
 */
import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { boot, nextPaint, openMenu } from './helpers';

/** The REST fixture with the Hero frame ready for development, and the Card's visible field bound to a property. */
function restFileWithHandoff(): Buffer {
  const doc = JSON.parse(readFileSync('tests/figma/fixtures/rest-file.json', 'utf8'));
  const walk = (node: any) => {
    if (node.id === '1:2') node.devStatus = { type: 'READY_FOR_DEV' };
    if (node.id === '1:4') node.componentPropertyReferences = { visible: 'Show card' };
    for (const child of node.children ?? []) walk(child);
  };
  walk(doc.document);
  return Buffer.from(JSON.stringify(doc));
}

test('B209a a REST import keeps a frame\'s Ready status as a badge, and a layer\'s component property references', async ({ page }: { page: Page }) => {
  await boot(page);
  await openMenu(page);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('.menu__item', { hasText: 'Import Figma JSON…' }).first().click(),
  ]);
  await chooser.setFiles({ name: 'rest-handoff.json', mimeType: 'application/json', buffer: restFileWithHandoff() });
  await nextPaint(page);
  await expect(page.locator('.toast').first()).toContainText('Imported');

  const badge = page.locator('[data-testid="layer-dev-status"]').first();
  await expect(badge).toHaveAttribute('data-status', 'READY_FOR_DEVELOPMENT');
  await expect(badge).toHaveText('Ready');

  const references = await page.evaluate(() => {
    const kids = window.__pigmaStore!.getState().file.document.children[0]!.children as any[];
    const hero = kids.find((node) => node.name === 'Hero');
    return hero.children.find((node: any) => node.name === 'Card').componentPropertyReferences;
  });
  expect(references).toEqual({ visible: 'Show card' });
});
