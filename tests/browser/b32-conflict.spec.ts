import { test, expect } from './rooms';
import type { Page } from '@playwright/test';

// These specs run a local relay or several browser contexts: under six-worker load they
// take 7-10s each, so they get more headroom than the 30s default.
test.setTimeout(60_000);

/**
 * Conflict resolution over the local relay.
 *
 * Two contexts join the same room; edits to DIFFERENT nodes must both survive,
 * and edits to the SAME node must converge to one value on both sides.
 */

/** Join with the room's key: the host creates it (returned), a guest pastes it. */
async function joinRoom(page: Page, nickname: string, roomId: string, relayUrl: string, key?: string): Promise<string> {
  await page.goto('/app/?blank=1');
  await page.waitForSelector('.app');
  await page.locator('.rail__button[aria-label="Rooms"]').click();
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
  // Joined when the room offers "Leave room" (the panel shows it only once online).
  await expect(page.locator('[aria-label="Leave room"]')).toBeVisible({ timeout: 15000 });
  return roomKey;
}

const shapes = (page: Page) =>
  page.locator('.canvas__svg rect, .canvas__svg ellipse, .canvas__svg path').count();

async function drawRect(page: Page, dx: number) {
  const box = (await page.locator('.canvas').boundingBox())!;
  await page.locator('.toolbar__button[aria-label="Rectangle"]').click();
  await page.mouse.move(box.x + box.width / 2 + dx - 50, box.y + box.height / 2 - 40);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx + 50, box.y + box.height / 2 + 40, { steps: 6 });
  await page.mouse.up();
}

test('B32a concurrent edits to different nodes both survive', async ({ browser, roomsRelay }) => {
  // A fresh room per test: a room keeps its ciphertext, and a re-used id would hold
  // another test's key.
  const roomId = `qa-conflict-diff-${Math.random().toString(36).slice(2, 8)}`;
  const alice = await browser.newContext();
  const bob = await browser.newContext();
  const alicePage = await alice.newPage();
  const bobPage = await bob.newPage();

  const key = await joinRoom(alicePage, 'alice', roomId, roomsRelay.url);
  await joinRoom(bobPage, 'bob', roomId, roomsRelay.url, key);

  const before = await shapes(alicePage);
  await drawRect(alicePage, -120);
  await drawRect(bobPage, 120);

  // Both drawings must be present on BOTH sides.
  await expect.poll(() => shapes(alicePage), { timeout: 20000 }).toBe(before + 2);
  await expect.poll(() => shapes(bobPage), { timeout: 20000 }).toBe(before + 2);

  await alice.close();
  await bob.close();
});

test('B32b concurrent edits to the same node converge', async ({ browser, roomsRelay }) => {
  // A fresh room per test: a room keeps its ciphertext, and a re-used id would hold
  // another test's key.
  const roomId = `qa-conflict-same-${Math.random().toString(36).slice(2, 8)}`;
  const alice = await browser.newContext();
  const bob = await browser.newContext();
  const alicePage = await alice.newPage();
  const bobPage = await bob.newPage();

  const key = await joinRoom(alicePage, 'alice', roomId, roomsRelay.url);
  await joinRoom(bobPage, 'bob', roomId, roomsRelay.url, key);

  await drawRect(alicePage, 0);
  await expect.poll(() => shapes(bobPage), { timeout: 20000 }).toBeGreaterThan(0);

  // Both move the SAME node to different places.
  const moveBy = async (page: Page, dx: number) => {
    await page.locator('.rail__button[aria-label="Layers"]').click();
    await page.locator('.layer-row', { hasText: 'Rectangle 1' }).first().click();
    await expect(page.locator('.layer-row--selected', { hasText: 'Rectangle 1' })).toHaveCount(1);
    const box = (await page.locator('.canvas').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
  };
  const readX = async (page: Page) => {
    await page.locator('.rail__button[aria-label="Layers"]').click();
    await page.locator('.layer-row', { hasText: 'Rectangle 1' }).first().click();
    await expect(page.locator('input[aria-label="X"]')).toBeVisible();
    return Number(await page.locator('input[aria-label="X"]').inputValue());
  };

  await moveBy(alicePage, -100);
  await moveBy(bobPage, 100);

  // Whatever the winner, both sides must agree: one converged value.
  await expect
    .poll(
      async () => {
        const a = await readX(alicePage);
        const b = await readX(bobPage);
        return Math.abs(a - b) < 1;
      },
      { timeout: 25000 },
    )
    .toBe(true);

  await alice.close();
  await bob.close();
});
