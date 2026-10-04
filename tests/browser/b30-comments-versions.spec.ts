import { test, expect, type Page } from '@playwright/test';
import { boot, tool } from './helpers';

async function openComments(page: Page) {
  await page.locator('.rail__button[aria-label="Comments"]').click();
  await page.waitForTimeout(400);
}

/** Place a comment pin using the Comment canvas tool. */
async function placePin(page: Page, dx = 0, dy = 0) {
  await tool(page, 'Comment').click();
  const box = (await page.locator('.canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
  await page.waitForTimeout(600);
}

const openCount = (page: Page) =>
  page.evaluate(() => {
    const m = (document.querySelector('.app__left')?.textContent ?? '').match(/(\d+)\s+open/i);
    return m ? Number(m[1]) : -1;
  });

test('B30a the Comment tool places a pin and the panel counts it', async ({ page }) => {
  await boot(page, { blank: true });
  await openComments(page);
  expect(await openCount(page), 'expected zero open comments initially').toBe(0);

  await placePin(page);
  await openComments(page);

  expect(await openCount(page), 'the pin was not counted as an open comment').toBe(1);
  await expect(page.locator('.app__left')).toContainText(/comment/i);
});

test('B30b a comment can be replied to in its thread', async ({ page }) => {
  await boot(page, { blank: true });
  await placePin(page);
  await openComments(page);

  // The thread composer must offer a way to post a reply.
  const reply = page.locator('.app__left textarea, .app__left input[aria-label*="eply" i]').first();
  await expect(reply, 'no reply composer in the comment thread').toHaveCount(1);
  await reply.fill('Looks good to me');
  const post = page.locator('.app__left button', { hasText: /reply|post|send|comment/i }).first();
  await post.click();
  await page.waitForTimeout(500);

  await expect(page.locator('.app__left')).toContainText('Looks good to me');
});

test('B30c a comment can be resolved', async ({ page }) => {
  await boot(page, { blank: true });
  await placePin(page);
  await openComments(page);

  const resolve = page.locator('.app__left button', { hasText: /resolve/i }).first();
  await expect(resolve, 'no resolve control in the comment thread').toHaveCount(1);
  await resolve.click();
  await page.waitForTimeout(600);

  expect(await openCount(page), 'resolving did not reduce the open count').toBe(0);
});

test('B30d comments persist across a reload', async ({ page }) => {
  await boot(page, { blank: true });
  await placePin(page);
  await openComments(page);
  expect(await openCount(page)).toBe(1);

  // Reload WITHOUT ?blank=1, which would boot a fresh empty document.
  await page.goto('/');
  await page.waitForSelector('.app');
  await openComments(page);
  expect(await openCount(page), 'the comment did not survive the reload').toBe(1);
});

// ------------------------------------------------------------ versions ----

async function drawRect(page: Page) {
  await tool(page, 'Rectangle').click();
  const box = (await page.locator('.canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 2 - 50);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 50, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(400);
}

const shapeCount = (page: Page) =>
  page.locator('.canvas__svg rect, .canvas__svg ellipse, .canvas__svg path').count();

async function openFilePanel(page: Page) {
  await page.locator('.rail__button[aria-label="File"]').click();
  await page.waitForTimeout(400);
}

test('B30e saving a version adds it to the snapshot timeline', async ({ page }) => {
  await boot(page, { blank: true });
  await openFilePanel(page);

  await page.locator('input[aria-label="Version name"]').fill('Milestone A');
  await page.locator('button[aria-label="Save version"]').click();
  await page.waitForTimeout(700);

  await expect(page.locator('.app__left')).toContainText('Milestone A');
});

test('B30f restoring a version is exactly one undoable entry', async ({ page }) => {
  await boot(page, { blank: true });

  // 1. One shape, saved as v1.
  await drawRect(page);
  const withShape = await shapeCount(page);
  expect(withShape).toBeGreaterThan(0);
  await openFilePanel(page);
  await page.locator('input[aria-label="Version name"]').fill('v1');
  await page.locator('button[aria-label="Save version"]').click();
  await page.waitForTimeout(700);

  // 2. Delete it, so v2 is VISIBLY different (this is what makes the assertions
  //    below meaningful - the previous version branched on whether anything
  //    changed, which left the pass ambiguous).
  await page.locator('.rail__button[aria-label="Layers"]').click();
  await tool(page, 'Move').click();
  const box = (await page.locator('.canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(400);
  expect(await shapeCount(page), 'the shape was not deleted').toBe(0);

  await openFilePanel(page);
  await page.locator('input[aria-label="Version name"]').fill('v2');
  await page.locator('button[aria-label="Save version"]').click();
  await page.waitForTimeout(700);

  // 3. Restore v1: the shape must come back.
  // Scope to v1 explicitly: the timeline lists every snapshot and each row has
  // its own control (`aria-label="Restore v1"`), so .first() would target v2.
  const restore = page.locator('button[aria-label="Restore v1"]');
  await expect(restore, 'no Restore v1 control on the timeline').toHaveCount(1);
  await restore.click();
  await page.waitForTimeout(800);
  expect(await shapeCount(page), 'restoring did not bring the shape back').toBe(withShape);

  // 4. Exactly ONE undoable entry: a single Ctrl+Z empties the canvas again.
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(600);
  expect(await shapeCount(page), 'restore was not a single undoable entry').toBe(0);
});
