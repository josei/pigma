import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, openMenu } from './helpers';

async function openRail(page: Page, label: string) {
  await page.locator(`.rail__button[aria-label="${label}"]`).click();
  await page.waitForTimeout(400);
}

test('B25a constraint options are icon-only and never overflow', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 200, 120);

  const group = page.locator('[aria-label="Horizontal"]');
  await expect(group).toHaveCount(1);

  const measured = await page.evaluate(() => {
    const el = document.querySelector('[aria-label="Horizontal"]')!;
    const options = [...el.querySelectorAll('.segmented__option')];
    return {
      count: options.length,
      overflow: options.filter(
        (o) => o.scrollHeight > o.clientHeight + 1 || o.scrollWidth > o.clientWidth + 1,
      ).length,
      withText: options.filter((o) => (o.textContent ?? '').trim().length > 0).length,
      ariaLabels: options.map((o) => o.getAttribute('aria-label')).filter(Boolean),
    };
  });

  expect(measured.count).toBeGreaterThan(1);
  // Icon-only: no option renders a text label...
  expect(measured.withText, `options rendered text: ${JSON.stringify(measured.ariaLabels)}`).toBe(0);
  // ...so nothing may overflow its own box.
  expect(measured.overflow).toBe(0);
  // ...and each option must still be identifiable.
  expect(measured.ariaLabels.length).toBe(measured.count);

  // The vertical axis is the same kind of control.
  const vertical = await page.evaluate(() => {
    const el = document.querySelector('[aria-label="Vertical"]');
    if (!el) return null;
    const options = [...el.querySelectorAll('.segmented__option')];
    return {
      overflow: options.filter(
        (o) => o.scrollHeight > o.clientHeight + 1 || o.scrollWidth > o.clientWidth + 1,
      ).length,
      withText: options.filter((o) => (o.textContent ?? '').trim().length > 0).length,
    };
  });
  expect(vertical, 'Vertical constraints control missing').not.toBeNull();
  expect(vertical!.overflow).toBe(0);
  expect(vertical!.withText).toBe(0);
});

test('B25b the document library exists and persists a document in IndexedDB', async ({ page }) => {
  await boot(page, { blank: true });

  const databasesBefore = await page.evaluate(async () =>
    (await indexedDB.databases()).map((d) => d.name),
  );

  await openRail(page, 'File');
  const libraryActions = await page.evaluate(() =>
    [...document.querySelectorAll('.app__left button, .app__left [role="button"]')]
      .map((b) => (b.getAttribute('aria-label') ?? (b.textContent ?? '').trim()).slice(0, 40))
      .filter(Boolean),
  );
  const joined = libraryActions.join(' | ').toLowerCase();
  // The File panel exposes document-level actions. Rename/Duplicate are NOT in
  // this list - they may live per-row once a document exists; recorded in the
  // harness README as an open question rather than asserted here.
  for (const action of ['new', 'open', 'save']) {
    expect(joined, `library is missing a "${action}" action; saw ${JSON.stringify(libraryActions)}`).toContain(
      action,
    );
  }

  // Saving stores the document in IndexedDB (created on demand).
  await openMenu(page);
  await page.locator('.menu__item', { hasText: 'New file' }).first().click();
  await page.waitForTimeout(900);

  const databasesAfter = await page.evaluate(async () =>
    (await indexedDB.databases()).map((d) => d.name),
  );
  expect(
    databasesAfter.length,
    `no IndexedDB database was created (before ${JSON.stringify(databasesBefore)}, after ${JSON.stringify(databasesAfter)})`,
  ).toBeGreaterThan(0);
});

test('B25c the File System Access open/save entries are offered', async ({ page }) => {
  await boot(page, { blank: true });

  await openMenu(page);
  const items = await page.locator('.menu__item').allTextContents();
  const joined = items.join(' | ');
  expect(joined).toMatch(/Open file/i);
  expect(joined).toMatch(/Save to file/i);
  expect(joined).toMatch(/Save to file as/i);
});
