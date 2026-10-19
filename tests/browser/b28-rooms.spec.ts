import { test, expect } from './rooms';
import type { Page } from '@playwright/test';

// These specs run a local relay or several browser contexts: under six-worker load they
// take 7-10s each, so they get more headroom than the 30s default.
test.setTimeout(60_000);

/**
 * Two-context ROOMS coverage.
 *
 * Skipped until the collab relay CLI lands (see ./rooms.ts): the fixture looks
 * for a package.json script matching /relay|collab|rooms/ and starts it on a
 * free port, so these tests begin exercising as soon as it exists.
 *
 * Control surface, from the discovery table in tests/browser/README.md:
 *   Room nickname / Room id / Room token / Relay base / Join room
 *   Room key (every room is encrypted: the host creates the key, a guest pastes it)
 *   Mode (read-only status)
 */

interface JoinOptions {
  nickname: string;
  roomId: string;
  relayUrl: string;
  /** The room's key. Omitted for the host, who creates the room and gets its key back. */
  key?: string;
}

/**
 * Join a room with its key. Rooms are always encrypted: the host creates the key
 * with "Create share link", a guest pastes the same key. Returns the key.
 */
async function joinRoom(page: Page, { nickname, roomId, relayUrl, key }: JoinOptions): Promise<string> {
  await page.goto('/app/?blank=1');
  await page.waitForSelector('.app');
  await page.locator('.rail__button[aria-label="Rooms"]').click();
  await page.waitForTimeout(300);

  await page.locator('input[aria-label="Room nickname"]').fill(nickname);
  await page.locator('input[aria-label="Room id"]').fill(roomId);
  await page.locator('[data-testid="rooms-advanced"] summary').click();
  await page.locator('input[aria-label="Relay base"]').fill(relayUrl);
  let roomKey = key;
  if (roomKey === undefined) {
    await page.locator('[aria-label="Create share link"]').click();
    roomKey = await page.locator('input[aria-label="Room key"]').inputValue();
  } else {
    await page.locator('input[aria-label="Room key"]').fill(roomKey);
  }
  await page.locator('[aria-label="Join room"]').click();
  await page.waitForTimeout(1200);
  return roomKey;
}

test('B28a two contexts join the same room with different nicknames', async ({
  browser,
  roomsRelay,
}) => {
  // A fresh room per test: a room keeps its ciphertext, and a re-used id would hold
  // another test's key.
  const roomId = `qa-room-1-${Math.random().toString(36).slice(2, 8)}`;
  const alice = await browser.newContext();
  const bob = await browser.newContext();
  const alicePage = await alice.newPage();
  const bobPage = await bob.newPage();

  const key = await joinRoom(alicePage, { nickname: 'alice', roomId, relayUrl: roomsRelay.url });
  await joinRoom(bobPage, { nickname: 'bob', roomId, relayUrl: roomsRelay.url, key });
  await alicePage.waitForTimeout(1500);

  // Each side sees the other as a peer, by nickname.
  await expect(alicePage.locator('[aria-label="Peer bob"]')).toHaveCount(1, { timeout: 15000 });
  await expect(bobPage.locator('[aria-label="Peer alice"]')).toHaveCount(1, { timeout: 15000 });

  // The panel reports a live mode rather than an error.
  await expect(alicePage.locator('.app__left')).not.toContainText(/Rooms error/i);

  await alice.close();
  await bob.close();
});

test('B28b the remote cursor is labelled with the peer nickname', async ({ browser, roomsRelay }) => {
  // A fresh room per test: a room keeps its ciphertext, and a re-used id would hold
  // another test's key.
  const roomId = `qa-room-2-${Math.random().toString(36).slice(2, 8)}`;
  const alice = await browser.newContext();
  const bob = await browser.newContext();
  const alicePage = await alice.newPage();
  const bobPage = await bob.newPage();

  const key = await joinRoom(alicePage, { nickname: 'alice', roomId, relayUrl: roomsRelay.url });
  await joinRoom(bobPage, { nickname: 'bob', roomId, relayUrl: roomsRelay.url, key });
  await alicePage.waitForTimeout(1200);

  // Bob moves his pointer over the canvas. The remote cursor is a <g> inside the
  // canvas overlay holding an arrow <path> plus a <text> label with the nickname:
  //   <g transform="translate(x y)"><path d="M 0 0 L 0 14 ..."/><text ...>bob</text></g>
  const box = (await bobPage.locator('.canvas').boundingBox())!;
  await bobPage.mouse.move(box.x + box.width / 2 - 60, box.y + box.height / 2 - 40);
  await bobPage.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 30, { steps: 8 });

  const cursorLabel = alicePage.locator('.canvas__overlay text', { hasText: 'bob' });
  await expect(cursorLabel).toHaveCount(1, { timeout: 15000 });
  await expect(cursorLabel).toHaveText('bob');

  // ...and it is attached to a cursor arrow, not loose text in the overlay.
  const cursorGlyph = alicePage.locator('.canvas__overlay g', {
    has: alicePage.locator('text', { hasText: 'bob' }),
  });
  await expect(cursorGlyph.locator('path')).toHaveCount(1);
  await expect(cursorGlyph).toHaveAttribute('transform', /translate\(/);

  await alice.close();
  await bob.close();
});

test('B28c a remote edit and selection reach the peer view', async ({ browser, roomsRelay }) => {
  // A fresh room per test: a room keeps its ciphertext, and a re-used id would hold
  // another test's key.
  const roomId = `qa-room-3-${Math.random().toString(36).slice(2, 8)}`;
  const alice = await browser.newContext();
  const bob = await browser.newContext();
  const alicePage = await alice.newPage();
  const bobPage = await bob.newPage();

  const key = await joinRoom(alicePage, { nickname: 'alice', roomId, relayUrl: roomsRelay.url });
  await joinRoom(bobPage, { nickname: 'bob', roomId, relayUrl: roomsRelay.url, key });
  await alicePage.waitForTimeout(1200);

  const overlayBefore = await alicePage.locator('.canvas__overlay').innerHTML();
  const shapesBefore = await alicePage
    .locator('.canvas__svg rect, .canvas__svg ellipse, .canvas__svg path')
    .count();

  // Bob draws and selects a shape.
  const box = (await bobPage.locator('.canvas').boundingBox())!;
  await bobPage.locator('.toolbar__button[aria-label="Rectangle"]').click();
  await bobPage.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 2 - 50);
  await bobPage.mouse.down();
  await bobPage.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 50, { steps: 6 });
  await bobPage.mouse.up();
  await bobPage.waitForTimeout(1500);

  // The remote edit appears in Alice's rendered document...
  await expect
    .poll(
      async () =>
        alicePage.locator('.canvas__svg rect, .canvas__svg ellipse, .canvas__svg path').count(),
      { timeout: 15000 },
    )
    .toBeGreaterThan(shapesBefore);

  // ...and the presence overlay updates beyond the cursor alone.
  //
  // LIMITATION: the remote SELECTION OUTLINE element could not be pinned down.
  // Alice has nothing selected, so this asserts that a peer-coloured stroke
  // appears in her overlay - the cursor uses `hsl(<hue>, 65%, 55%)`, and the
  // selection uses the same peer colour - rather than naming a specific element.
  await expect
    .poll(
      async () =>
        alicePage.evaluate(() => {
          const overlay = document.querySelector('.canvas__overlay');
          if (!overlay) return 0;
          return [...overlay.querySelectorAll('*')].filter((el) =>
            /hsl\(\s*\d+\s*,\s*65%\s*,\s*55%\s*\)/.test(
              `${el.getAttribute('stroke') ?? ''}${el.getAttribute('fill') ?? ''}`,
            ),
          ).length;
        }),
      { timeout: 15000 },
    )
    .toBeGreaterThan(1);
  expect(await alicePage.locator('.canvas__overlay').innerHTML()).not.toBe(overlayBefore);

  await alice.close();
  await bob.close();
});

test('B28d follow mode centres on the peer and Esc stops following', async ({ browser, roomsRelay }) => {
  // A fresh room per test: a room keeps its ciphertext, and a re-used id would hold
  // another test's key.
  const roomId = `qa-room-4-${Math.random().toString(36).slice(2, 8)}`;
  const alice = await browser.newContext();
  const bob = await browser.newContext();
  const alicePage = await alice.newPage();
  const bobPage = await bob.newPage();

  const key = await joinRoom(alicePage, { nickname: 'alice', roomId, relayUrl: roomsRelay.url });
  await joinRoom(bobPage, { nickname: 'bob', roomId, relayUrl: roomsRelay.url, key });
  await alicePage.waitForTimeout(1500);

  const follow = alicePage.locator('[aria-label="Follow bob"]');
  await expect(follow).toHaveCount(1, { timeout: 15000 });

  // Move Bob's viewport so following has something to centre on.
  await bobPage.locator('button[aria-label="Zoom in"]').click();
  await bobPage.waitForTimeout(600);

  const before = await alicePage.locator('.canvas__svg').getAttribute('viewBox');
  await follow.click();
  await expect
    .poll(async () => alicePage.locator('.canvas__svg').getAttribute('viewBox'), { timeout: 10000 })
    .not.toBe(before);
  await expect(alicePage.locator('[aria-label="Stop following bob"]')).toHaveCount(1);

  // Esc must stop following.
  await alicePage.keyboard.press('Escape');
  await expect
    .poll(
      async () => alicePage.locator('[aria-label="Stop following bob"]').count(),
      { timeout: 10000 },
    )
    .toBe(0);

  await alice.close();
  await bob.close();
});
