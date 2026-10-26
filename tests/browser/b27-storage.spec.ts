import { test, expect, type Page } from '@playwright/test';

const LEGACY_KEY = 'pigma:document:v1';

/** Wait for the app shell without asserting a particular document. */
/** True once the document library (IndexedDB `pigma`, store `documents`) holds a record saved at or after `since`. */
async function librarySavedSince(page: Page, since: number): Promise<boolean> {
  return page.evaluate(
    (start) =>
      new Promise<boolean>((resolve) => {
        const open = indexedDB.open('pigma', 1);
        open.onerror = () => resolve(false);
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction('documents').objectStore('documents').getAll();
          request.onerror = () => {
            db.close();
            resolve(false);
          };
          request.onsuccess = () => {
            db.close();
            resolve((request.result as Array<{ savedAt?: number }>).some((record) => (record.savedAt ?? 0) >= start));
          };
        };
      }),
    since,
  );
}

async function openApp(page: Page, url = '/app/?blank=1') {
  await page.goto(url);
  await page.waitForSelector('.app');
  await page.evaluate(() => document.fonts.ready);
}

/** The persisted envelope the app writes to `pigma:document:v1`. */
function persistEnvelope(name: string, savedAt: number) {
  return JSON.stringify({ schema: 'pigma/persist/1', savedAt, pageId: '0:1', file: legacyFile(name) });
}

/** A minimal document body for the persisted envelope. */
function legacyFile(name: string) {
  return {
    schema: 'pigma/1',
    name,
    lastModified: Date.now(),
    document: {
      id: '0:0',
      name: 'Document',
      type: 'DOCUMENT',
      visible: true,
      locked: false,
      opacity: 1,
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
      width: 0,
      height: 0,
      fills: [],
      strokes: [],
      children: [
        {
          id: '0:1',
          name: 'Page 1',
          type: 'CANVAS',
          visible: true,
          locked: false,
          opacity: 1,
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
          width: 0,
          height: 0,
          fills: [],
          strokes: [],
          children: [],
        },
      ],
    },
  };
}

/** Names of every record in the library database. */
async function libraryRecordNames(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const names = (await indexedDB.databases()).map((d) => d.name);
    if (!names.includes('pigma')) return [];
    return new Promise<string[]>((resolve) => {
      const open = indexedDB.open('pigma');
      open.onerror = () => resolve([]);
      open.onsuccess = () => {
        const db = open.result;
        const first = [...db.objectStoreNames][0];
        if (!first) {
          db.close();
          return resolve([]);
        }
        const req = db.transaction(first, 'readonly').objectStore(first).getAll();
        req.onsuccess = () => {
          const out = (req.result as Array<Record<string, unknown>>).map((r) => {
            const value = (r as { name?: unknown; file?: { name?: unknown } }).name ??
              (r as { file?: { name?: unknown } }).file?.name;
            return typeof value === 'string' ? value : '';
          });
          db.close();
          resolve(out);
        };
        req.onerror = () => {
          db.close();
          resolve([]);
        };
      };
    });
  });
}

test('B27a a clean boot shows no spurious "Recovered" toast', async ({ page }) => {
  // Nothing was lost: a normal boot must not claim a recovery.
  await openApp(page);
  const toasts = await page.locator('.toast').allTextContents();
  expect(
    toasts.join(' | '),
    `unexpected recovery toast on a clean boot: ${JSON.stringify(toasts)}`,
  ).not.toMatch(/recovered/i);
});

test('B27b a legacy single-document key is migrated into the library', async ({ page }) => {
  // Seed the legacy key exactly as the previous build left it, then boot.
  await page.goto('/app/');
  await page.evaluate(
    (seed: { key: string; value: string }) => localStorage.setItem(seed.key, seed.value),
    { key: LEGACY_KEY, value: persistEnvelope('Legacy Design', 1) },
  );
  await openApp(page, '/app/');

  // The library database is created and holds the migrated document.
  const library = await page.evaluate(async () => {
    const names = (await indexedDB.databases()).map((d) => d.name);
    if (!names.includes('pigma')) return { names, count: 0 };
    const count = await new Promise<number>((resolve) => {
      const open = indexedDB.open('pigma');
      open.onerror = () => resolve(0);
      open.onsuccess = () => {
        const db = open.result;
        const storeNames = [...db.objectStoreNames];
        if (storeNames.length === 0) {
          db.close();
          return resolve(0);
        }
        const firstStore = storeNames[0];
        if (!firstStore) {
          db.close();
          return resolve(0);
        }
        const tx = db.transaction(firstStore, 'readonly');
        const req = tx.objectStore(firstStore).count();
        req.onsuccess = () => {
          const n = req.result;
          db.close();
          resolve(n);
        };
        req.onerror = () => {
          db.close();
          resolve(0);
        };
      };
    });
    return { names, count };
  });

  expect(library.names, `no library database; saw ${JSON.stringify(library.names)}`).toContain('pigma');
  expect(library.count, 'the legacy document was not migrated into the library').toBeGreaterThan(0);

  // The product ADOPTS an unknown legacy payload as a new document rather than
  // opening it in place, so assert it is retrievable from the library by name.
  const names = await libraryRecordNames(page);
  expect(
    names.join(' | '),
    `the legacy payload was not adopted into the library; records: ${JSON.stringify(names)}`,
  ).toContain('Legacy Design');
});

test('B27c a stale crash marker cannot overwrite newer library work', async ({ page }) => {
  // Seed a legacy marker claiming an older document, then a NEWER library entry
  // through the app, and reload: the newer work must win.
  await page.goto('/app/');
  await page.evaluate(
    (seed: { key: string; value: string }) => localStorage.setItem(seed.key, seed.value),
    { key: LEGACY_KEY, value: persistEnvelope('Stale Marker Doc', 1) },
  );
  await page.goto('/app/');
  await page.waitForSelector('.app');
  await page.evaluate(() => document.fonts.ready);

  // Make a real edit so the library copy is unambiguously newer.
  const editStarted = Date.now();
  await page.locator('.toolbar__button[aria-label="Rectangle"]').click();
  const box = (await page.locator('.canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 2 - 50);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 50, { steps: 6 });
  await page.mouse.up();
  // Wait for the library to record a save made after the edit, read from IndexedDB, not for a fixed time.
  await expect.poll(() => librarySavedSince(page, editStarted), { timeout: 10000, message: 'the edit was not saved to the library' }).toBe(true);

  const editedTitle = await page.locator('input[aria-label="File name"]').inputValue();
  const layersAfterEdit = await page.locator('.layer-row').count();

  // Re-plant the stale marker and reload.
  await page.evaluate(
    (seed: { key: string; value: string }) => localStorage.setItem(seed.key, seed.value),
    { key: LEGACY_KEY, value: persistEnvelope('Stale Marker Doc', 1) },
  );
  await page.reload();
  await page.waitForSelector('.app');

  // The discriminator is CONTENT, not the name: the app adopts the seeded payload
  // as a document, so both the stale marker and the newer library copy are named
  // "Stale Marker Doc". The stale marker's file has NO shapes, so if it won the
  // canvas would be empty.
  // The local document loads after the app shows: wait for its shapes to reach the canvas.
  await expect
    .poll(() => page.locator('.canvas__svg rect, .canvas__svg ellipse, .canvas__svg path').count(), { timeout: 10000 })
    .toBeGreaterThan(0);
  const shapesAfter = await page
    .locator('.canvas__svg rect, .canvas__svg ellipse, .canvas__svg path')
    .count();
  expect(
    shapesAfter,
    `the stale marker overwrote newer work: the canvas has ${shapesAfter} shape(s) but the edited document had one (title "${editedTitle}")`,
  ).toBeGreaterThan(0);
  expect(await page.locator('.layer-row').count()).toBeGreaterThanOrEqual(layersAfterEdit);
});
