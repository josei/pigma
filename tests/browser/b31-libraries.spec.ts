import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, field, tool } from './helpers';

/**
 * Node types in the document, read from the app store.
 *
 * `.layer-row` counts are NOT a stable proxy here: the tree auto-expands to
 * reveal the selection, and an instance is nested, so the row count can be
 * unchanged even when an instance was created.
 */
async function nodeTypes(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const store = window.__pigmaStore;
    if (!store) throw new Error('window.__pigmaStore is not exposed');
    const out: string[] = [];
    const walk = (node: { type: string; children?: unknown[] }): void => {
      out.push(node.type);
      for (const child of (node.children ?? []) as Array<{ type: string; children?: unknown[] }>) {
        walk(child);
      }
    };
    walk(store.getState().file.document);
    return out;
  });
}

async function openAssets(page: Page) {
  await page.locator('.rail__button[aria-label="Assets"]').click();
  await page.waitForTimeout(400);
}

const publish = (page: Page) => page.locator('button[aria-label="Publish library"]');
const panelText = (page: Page) =>
  page.evaluate(() => (document.querySelector('.app__left')?.textContent ?? '').replace(/\s+/g, ' '));

test('B31a publishing a library changes its status', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 200, 120);
  await tool(page, 'Create component').click();
  await page.waitForTimeout(400);
  await openAssets(page);

  expect(await panelText(page)).toMatch(/not published/i);

  await expect(publish(page)).toHaveCount(1);
  await publish(page).click();
  await page.waitForTimeout(700);

  const after = await panelText(page);
  expect(after, 'the library still reports itself as unpublished').not.toMatch(/not published/i);
});

test('B31b a published component can be instantiated', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 200, 120);
  const master = (await page
    .locator('.layer-row--selected .layer-row__name')
    .first()
    .textContent())!;
  await tool(page, 'Create component').click();
  await page.waitForTimeout(400);
  await openAssets(page);
  await publish(page).click();
  await page.waitForTimeout(600);

  const before = await nodeTypes(page);
  expect(before).toContain('COMPONENT');
  expect(before).not.toContain('INSTANCE');

  await page.locator('.app__left .layer-row', { hasText: master }).first().dblclick();
  await page.waitForTimeout(800);

  // The instance must exist in the DOCUMENT, not merely change a row count.
  const after = await nodeTypes(page);
  expect(after, `no INSTANCE node after double-clicking the asset; types: ${JSON.stringify(after)}`).toContain(
    'INSTANCE',
  );
});

test('B31c editing and republishing the master offers an update for an out-of-date instance', async ({
  page,
}) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 200, 120);
  const master = (await page
    .locator('.layer-row--selected .layer-row__name')
    .first()
    .textContent())!;
  const masterFill = await field(page, 'Fill colour').inputValue();
  await tool(page, 'Create component').click();
  await page.waitForTimeout(400);
  await openAssets(page);
  await publish(page).click();
  await page.waitForTimeout(600);

  // Insert an instance so there is something that can go out of date.
  await page.locator('.app__left .layer-row', { hasText: master }).first().dblclick();
  await page.waitForTimeout(700);

  // Edit the MASTER's fill.
  await page.locator('.rail__button[aria-label="Layers"]').click();
  await page.waitForTimeout(300);
  await page
    .locator('.layer-row')
    .filter({ has: page.locator('.layer-row__icon path[d*="M8 1.5 11 4.5"]') })
    .first()
    .click();
  await field(page, 'Fill colour').fill('#ff0000');
  await field(page, 'Fill colour').press('Enter');
  await page.waitForTimeout(400);
  expect(await field(page, 'Fill colour').inputValue()).not.toBe(masterFill);

  // Republish; the instance is now out of date and an update affordance appears.
  // After the first publish the control is relabelled "Republish", so the
  // original `Publish library` locator no longer resolves.
  await openAssets(page);
  const republish = page.locator('button[aria-label="Republish library"], button[aria-label="Publish library"]').first();
  await expect(republish, 'no publish/republish control in the Assets panel').toHaveCount(1);
  await republish.click();
  await page.waitForTimeout(700);

  // The affordance may live in the Assets panel OR on the instance's properties,
  // so search the whole app rather than assuming one location.
  const updateAffordance = await page.evaluate(() =>
    [...document.querySelectorAll('button, [role="button"]')]
      .map((b) => b.getAttribute('aria-label') ?? (b.textContent ?? '').trim())
      .filter((c) => /update|out of date|out-of-date|sync/i.test(c)),
  );
  expect(
    updateAffordance && updateAffordance.length > 0,
    `no update affordance for the out-of-date instance. All controls: ${JSON.stringify(
      await page.evaluate(() =>
        [...document.querySelectorAll('button')]
          .map((b) => b.getAttribute('aria-label') ?? (b.textContent ?? '').trim())
          .filter(Boolean),
      ),
    )}`,
  ).toBe(true);
});
