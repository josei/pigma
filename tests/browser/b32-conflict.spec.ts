import { test, expect } from './rooms';
import type { Page } from '@playwright/test';

/**
 * Conflict resolution over the local relay.
 *
 * Two contexts join the same room; edits to DIFFERENT nodes must both survive,
 * and edits to the SAME node must converge to one value on both sides.
 */

async function joinRoom(page: Page, nickname: string, roomId: string, relayUrl: string) {
  await page.goto('/?blank=1');
  await page.waitForSelector('.app');
  await page.locator('.rail__button[aria-label="Rooms"]').click();
  await page.waitForTimeout(300);
  await page.locator('input[aria-label="Room nickname"]').fill(nickname);
  await page.locator('input[aria-label="Room id"]').fill(roomId);
  await page.locator('input[aria-label="Relay base"]').fill(relayUrl);
  const plaintext = page.locator('input[type="checkbox"]').first();
  if (await plaintext.count()) await plaintext.check();
  await page.locator('[aria-label="Join room"]').click();
  await page.waitForTimeout(1200);
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
  await page.waitForTimeout(700);
}

test('B32a concurrent edits to different nodes both survive', async ({ browser, roomsRelay }) => {
  const roomId = 'qa-conflict-diff';
  const alice = await browser.newContext();
  const bob = await browser.newContext();
  const alicePage = await alice.newPage();
  const bobPage = await bob.newPage();

  await joinRoom(alicePage, 'alice', roomId, roomsRelay.url);
  await joinRoom(bobPage, 'bob', roomId, roomsRelay.url);

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
  const roomId = 'qa-conflict-same';
  const alice = await browser.newContext();
  const bob = await browser.newContext();
  const alicePage = await alice.newPage();
  const bobPage = await bob.newPage();

  await joinRoom(alicePage, 'alice', roomId, roomsRelay.url);
  await joinRoom(bobPage, 'bob', roomId, roomsRelay.url);

  await drawRect(alicePage, 0);
  await expect.poll(() => shapes(bobPage), { timeout: 20000 }).toBeGreaterThan(0);

  // Both move the SAME node to different places.
  const moveBy = async (page: Page, dx: number) => {
    await page.locator('.rail__button[aria-label="Layers"]').click();
    await page.locator('.layer-row', { hasText: 'Rectangle 1' }).first().click();
    await page.waitForTimeout(200);
    const box = (await page.locator('.canvas').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(1200);
  };
  const readX = async (page: Page) => {
    await page.locator('.rail__button[aria-label="Layers"]').click();
    await page.locator('.layer-row', { hasText: 'Rectangle 1' }).first().click();
    await page.waitForTimeout(200);
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
