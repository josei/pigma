/**
 * A Figma JSON ellipse with the arc data of a full circle imports without an "ellipse:arcData" warning, since Pigma draws it whole. A
 * partial arc still gets the warning. The rule is unit-tested (tests/figma/rest-arc-report.test.ts); this imports through the real menu
 * and file chooser and reads the import toast.
 */
import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { boot, nextPaint, openMenu } from './helpers';

/** The REST fixture with its ellipse (1:5) given the arc data Figma writes for a plain ellipse, or the partial arc it has. */
function restFileWithArc(arcData: unknown): Buffer {
  const doc = JSON.parse(readFileSync('tests/figma/fixtures/rest-file.json', 'utf8'));
  const walk = (node: any) => {
    if (node.id === '1:5') node.arcData = arcData;
    for (const child of node.children ?? []) walk(child);
  };
  walk(doc.document);
  return Buffer.from(JSON.stringify(doc));
}

async function importWith(page: Page, arcData: unknown): Promise<string> {
  await boot(page);
  await openMenu(page);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('.menu__item', { hasText: 'Import Figma JSON…' }).first().click(),
  ]);
  await chooser.setFiles({ name: 'rest-arc.json', mimeType: 'application/json', buffer: restFileWithArc(arcData) });
  await nextPaint(page);
  const toast = page.locator('.toast').first();
  await expect(toast).toContainText('Imported');
  return (await toast.textContent()) ?? '';
}

test('B214a a full-circle ellipse imports without an arc warning, and a partial arc still gets one', async ({ page }: { page: Page }) => {
  const full = await importWith(page, { startingAngle: 0, endingAngle: 6.2831854820251465, innerRadius: 0 });
  expect(full).not.toContain('ellipse:arcData');
});

test('B214b a partial arc still gets the arc warning', async ({ page }: { page: Page }) => {
  const partial = await importWith(page, { startingAngle: 0, endingAngle: 4.71238898, innerRadius: 0.5 });
  expect(partial).toContain('ellipse:arcData');
});
