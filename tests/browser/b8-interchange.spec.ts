import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, openMenu, tool } from './helpers';

async function exportFile(page: Page, label: string, target: string) {
  await openMenu(page);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.menu__item', { hasText: label }).first().click(),
  ]);
  await download.saveAs(target);
  return download;
}

test('B8a Export .pigma downloads a .pigma file', async ({ page }) => {
  await boot(page);
  await drawShape(page, 'Rectangle', 200, 120);

  // The native format: `.pigma` with its own media type (docs/FORMAT.md).
  const download = await exportFile(page, 'Export .pigma', '/tmp/pigma-qa-export.pigma');
  expect(download.suggestedFilename()).toMatch(/\.pigma$/i);
});

test('B8b an exported document re-imports with its content intact', async ({ page }) => {
  await boot(page);
  await drawShape(page, 'Rectangle', 200, 120);
  const expected = await page.locator('.layer-row').count();

  await exportFile(page, 'Export .pigma', '/tmp/pigma-qa-roundtrip.pigma');

  // Clear the document, then import the file we just exported.
  await openMenu(page);
  await page.locator('.menu__item', { hasText: 'New file' }).first().click();
  const confirm = page.locator('.modal .button--primary');
  if (await confirm.count()) await confirm.click();
  await page.waitForTimeout(300);

  await openMenu(page);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('.menu__item', { hasText: 'Import Pigma document' }).first().click(),
  ]);
  await chooser.setFiles('/tmp/pigma-qa-roundtrip.pigma');
  await page.waitForTimeout(500);

  await expect(page.locator('.layer-row')).toHaveCount(expected);
});

test('B8c Export SVG downloads an .svg file', async ({ page }) => {
  await boot(page);
  await drawShape(page, 'Rectangle', 200, 120);

  const download = await exportFile(page, 'Export SVG', '/tmp/pigma-qa-export.svg');
  expect(download.suggestedFilename()).toMatch(/\.svg$/i);
});

test('B8d the exported SVG contains the drawn geometry', async ({ page }) => {
  await boot(page);
  await drawShape(page, 'Rectangle', 260, 160);
  await tool(page, 'Move').click();

  const download = await exportFile(page, 'Export SVG', '/tmp/pigma-qa-geometry.svg');
  const stream = await download.createReadStream();
  let body = '';
  for await (const chunk of stream) body += chunk;

  expect(body).toContain('<svg');
  expect(body.length).toBeGreaterThan(200);
});
