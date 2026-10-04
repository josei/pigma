import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape } from './helpers';

/**
 * Text styling in the generated code.
 *
 * Covers what the generators express TODAY for a styled text layer, so the rows
 * the compatibility matrix claims are backed by a browser test. SwiftUI/Compose
 * coverage for the same properties is added as the generators gain them.
 */

async function inspect(page: Page): Promise<void> {
  const tab = page.locator('.tab', { hasText: 'Inspect' });
  await expect(tab).toHaveCount(1);
  await tab.click();
  await page.waitForTimeout(350);
}

async function code(page: Page): Promise<string> {
  return (await page.locator('pre[aria-label="Generated code"]').textContent()) ?? '';
}

/** Set a text style through the store, exactly as the properties panel does. */
async function styleText(page: Page, patch: Record<string, unknown>): Promise<void> {
  await page.evaluate((stylePatch) => {
    const store = window.__pigmaStore;
    if (!store) throw new Error('window.__pigmaStore is not exposed');
    const state = store.getState() as unknown as {
      updateSelectedTextStyle: (patch: Record<string, unknown>) => void;
    };
    state.updateSelectedTextStyle(stylePatch);
  }, patch);
  await page.waitForTimeout(250);
}

test('B45a CSS carries the text spacing and alignment that were set', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Text', 200, 60);

  await styleText(page, {
    letterSpacing: { unit: 'PERCENT', value: 5 },
    lineHeight: { unit: 'PERCENT', value: 150 },
    textAlignHorizontal: 'CENTER',
  });

  await inspect(page);
  const css = await code(page);

  expect(css, 'CSS dropped the letter spacing').toMatch(/letter-spacing:\s*5%/);
  expect(css, 'CSS dropped the line height').toMatch(/line-height:\s*150%/);
  expect(css, 'CSS dropped the alignment').toMatch(/text-align:\s*center/);
});

test('B45b CSS reflects a changed alignment rather than a fixed value', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Text', 200, 60);
  await inspect(page);

  expect(await code(page), 'the default alignment is not LEFT').toMatch(/text-align:\s*left/);

  await styleText(page, { textAlignHorizontal: 'RIGHT' });
  expect(await code(page), 'the alignment change did not reach the CSS').toMatch(/text-align:\s*right/);
  expect(await code(page), 'the old alignment is still emitted').not.toMatch(/text-align:\s*left/);
});
