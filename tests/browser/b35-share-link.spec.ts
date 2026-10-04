import { test, expect, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';

/**
 * Share links: `#open=<url>` points at a hosted document.
 *
 * The embedded `#design=` form was REMOVED by explicit product decision, so
 * embedding a document in the URL itself is not supported (see docs/FORMAT.md:
 * URL length limits and images make it unworkable). Only the hosted form is
 * covered here.
 *
 * A tiny static server serves the documents, including a deliberately
 * cross-origin-ish and a deliberately malformed case.
 */

const SHARED = JSON.stringify({
  schema: 'pigma/1',
  name: 'Shared Doc',
  lastModified: 1767225600000,
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
});

const NOT_PIGMA = JSON.stringify({ hello: 'not a document' });

let server: Server;
let base = '';

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const url = (req.url ?? '').split('?')[0];
    if (url === '/shared.pigma' || url === '/shared.json') {
      res.writeHead(200, {
        'content-type': url.endsWith('.pigma') ? 'application/x-pigma+json' : 'application/json',
        'access-control-allow-origin': '*',
      });
      res.end(SHARED);
      return;
    }
    if (url === '/not-pigma.json') {
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(NOT_PIGMA);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  base = `http://127.0.0.1:${port}`;
});

test.afterAll(async () => {
  const done = once(server, 'close');
  server.close();
  await done;
});

const fileName = (page: Page) => page.locator('input[aria-label="File name"]').inputValue();

async function openLink(page: Page, link: string) {
  await page.goto(`/?blank=1#open=${encodeURIComponent(link)}`);
  await page.waitForSelector('.app');
  await page.waitForTimeout(1500);
}

test('B35a a share link loads the served document in a fresh context', async ({ page }) => {
  await openLink(page, `${base}/shared.pigma`);
  expect(await fileName(page), 'the shared document was not opened').toContain('Shared Doc');
});

test('B35b a network/CORS failure shows an explicit error, not a blank screen', async ({ page }) => {
  // Nothing listens on this port.
  await openLink(page, 'http://127.0.0.1:9/does-not-exist.pigma');

  // The app must still be a working editor...
  await expect(page.locator('.app')).toBeVisible();
  await expect(page.locator('.canvas')).toBeVisible();

  // ...and must surface the failure through the app's own error surface. An
  // earlier version of this check matched ANY error-ish word anywhere on the
  // page, which passed vacuously; require a toast.
  const toasts = await page.locator('.toast').allTextContents();
  expect(
    toasts.join(' | '),
    `no error toast for an unreachable share link; toasts were ${JSON.stringify(toasts)}`,
  ).toMatch(/could not|failed|error|unreachable|not found/i);
});

test('B35c a non-Pigma payload is rejected', async ({ page }) => {
  await openLink(page, `${base}/not-pigma.json`);
  await expect(page.locator('.app')).toBeVisible();

  const name = await fileName(page);
  const toasts = await page.locator('.toast').allTextContents();

  // It must NOT be adopted as a document...
  expect(name, 'a non-Pigma payload was adopted as the document').not.toMatch(/not a document/i);
  // ...and the rejection must be visible through the app's error surface.
  expect(
    toasts.join(' | '),
    `no rejection toast for a non-Pigma payload; toasts were ${JSON.stringify(toasts)}`,
  ).toMatch(/invalid|not a pigma|unsupported|malformed|could not|failed|error/i);
});

test('B35d opening a share link does not clobber an existing local document', async ({ page }) => {
  // Make a local document first.
  await page.goto('/?blank=1');
  await page.waitForSelector('.app');
  const box = (await page.locator('.canvas').boundingBox())!;
  await page.locator('.toolbar__button[aria-label="Rectangle"]').click();
  await page.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 2 - 50);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 50, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(900);

  const localName = await fileName(page);
  const localShapes = await page
    .locator('.canvas__svg rect, .canvas__svg ellipse, .canvas__svg path')
    .count();
  expect(localShapes).toBeGreaterThan(0);

  // Opening the link must not overwrite the local work: it should open the
  // shared document without destroying what was already there.
  await openLink(page, `${base}/shared.pigma`);

  // The shared document is what is open now...
  expect(await fileName(page)).toContain('Shared Doc');

  // ...and going back to the local document still finds it intact.
  await page.goto('/');
  await page.waitForSelector('.app');
  await page.waitForTimeout(1200);
  const afterShapes = await page
    .locator('.canvas__svg rect, .canvas__svg ellipse, .canvas__svg path')
    .count();
  expect(
    afterShapes,
    `the local document was clobbered by opening a share link (had ${localShapes} shape(s), now ${afterShapes}, name was "${localName}")`,
  ).toBeGreaterThan(0);
});
