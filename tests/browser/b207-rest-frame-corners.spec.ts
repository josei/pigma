/**
 * A Figma REST frame keeps its corner radius on import, so a rounded frame is drawn rounded on the canvas. The conversion is
 * unit-tested (tests/figma/rest-frame-corners.test.ts); this imports through the real menu and file chooser.
 */
import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { boot, nextPaint, openMenu } from './helpers';

/** The REST fixture with the Hero frame given a 12-unit corner radius. The chooser takes the file as a buffer, so nothing is written. */
function restFileWithRoundedHero(): Buffer {
  const doc = JSON.parse(readFileSync('tests/figma/fixtures/rest-file.json', 'utf8'));
  const find = (node: { id: string; children?: unknown[] }): { id: string; cornerRadius?: number } | undefined => {
    if (node.id === '1:2') return node as { id: string; cornerRadius?: number };
    for (const child of (node.children ?? []) as Array<{ id: string; children?: unknown[] }>) {
      const found = find(child);
      if (found) return found;
    }
    return undefined;
  };
  find(doc.document)!.cornerRadius = 12;
  return Buffer.from(JSON.stringify(doc));
}

test('B207a a REST frame keeps its corner radius on import, and the canvas draws it rounded', async ({ page }: { page: Page }) => {
  await boot(page);
  await openMenu(page);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('.menu__item', { hasText: 'Import Figma JSON…' }).first().click(),
  ]);
  await chooser.setFiles({ name: 'rest-rounded.json', mimeType: 'application/json', buffer: restFileWithRoundedHero() });
  await nextPaint(page);
  await expect(page.locator('.toast').first()).toContainText('Imported');

  const radius = await page.evaluate(() => {
    const kids = window.__pigmaStore!.getState().file.document.children[0]!.children as Array<{ name: string; cornerRadius?: number }>;
    return kids.find((node) => node.name === 'Hero')?.cornerRadius;
  });
  expect(radius).toBe(12);

  // The Hero is a top-level layer, so selecting it from the layers list shows its radius in the panel.
  await page.locator('.layer-row', { hasText: 'Hero' }).first().click();
  await nextPaint(page);
  // A rounded box is a path with curve commands in its outline, where a square one is only straight lines. The Hero is 400 x 300.
  const rounded = await page.locator('.canvas__svg path').evaluateAll((paths) =>
    paths.some((path) => {
      const box = (path as SVGGraphicsElement).getBBox();
      return Math.round(box.width) === 400 && Math.round(box.height) === 300 && /[CA]/.test(path.getAttribute('d') ?? '');
    }),
  );
  expect(rounded).toBe(true);
});
