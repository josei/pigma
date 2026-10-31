/**
 * A Figma-made .fig file's SVG export setting survives the import: the WhiteOpenFigOutlinedIcon frame shows its Export row in the
 * panel, as an SVG at scale 1. The conversion is unit-tested (tests/figma/native-export-settings.test.ts); this imports the sample
 * through the real menu and file chooser.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, nextPaint, openMenu } from './helpers';

const FIXTURES = 'tests/figma/fixtures';

test('B212a a Figma .fig export setting imports, and the frame\'s Export row shows it as an SVG at scale 1', async ({ page }: { page: Page }) => {
  await boot(page);
  await openMenu(page);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('.menu__item', { hasText: 'Import .fig…' }).first().click(),
  ]);
  await chooser.setFiles(`${FIXTURES}/openfigs.fig`);
  await nextPaint(page);
  await expect(page.locator('.toast').first()).toContainText('Imported');

  await page.locator('.layer-row', { hasText: 'WhiteOpenFigOutlinedIcon' }).first().click();
  await nextPaint(page);
  await expect(page.getByLabel('Export format')).toHaveCount(1);
  await expect(page.getByLabel('Export format')).toHaveValue('SVG');
  // An SVG takes no scale, so the panel offers none; the scale of 1 is checked by the unit test.
  await expect(page.getByLabel('Export scale')).toHaveCount(0);
});
