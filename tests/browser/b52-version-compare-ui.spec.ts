import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape } from './helpers';

/**
 * Version compare in the UI: highlighting the differences on the canvas,
 * read-only, with no cost to history.
 *
 * The pure diff is covered by b51; this covers the compare STATE - that entering
 * and leaving compare is a view change only.
 */

async function openFilePanel(page: Page): Promise<void> {
  await page.locator('.rail__button[aria-label="File"]').click();
  await page.waitForTimeout(400);
}

async function saveVersion(page: Page, name: string): Promise<void> {
  await openFilePanel(page);
  await page.locator('input[aria-label="Version name"]').fill(name);
  await page.locator('button[aria-label="Save version"]').click();
  await page.waitForTimeout(700);
}

/** The top-level shape types on the page, in order. */
async function shapeTypes(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const store = window.__pigmaStore;
    if (!store) throw new Error('window.__pigmaStore is not exposed');
    const file = (store.getState() as unknown as {
      file: { document: { children: Array<{ children: Array<{ type: string }> }> } };
    }).file;
    return file.document.children[0]!.children.map((n) => n.type);
  });
}

/** Undo-stack depth, i.e. how many history entries exist. */
async function historyDepth(page: Page): Promise<number> {
  return page.evaluate(() => {
    const store = window.__pigmaStore;
    if (!store) throw new Error('window.__pigmaStore is not exposed');
    return (store.getState() as unknown as { past: unknown[] }).past.length;
  });
}

const overlay = (page: Page) => page.locator('[data-testid="compare-overlay"]');
const highlights = (page: Page, kind: string) => page.locator(`[data-testid="compare-overlay"] rect[data-compare="${kind}"]`);

test('B52a comparing after a move highlights the node as changed', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 160, 120);
  await saveVersion(page, 'Before move');

  // Close the File panel, move the layer with a real UI edit, then compare.
  await page.locator('.rail__button[aria-label="File"]').click();
  await page.waitForTimeout(300);
  // The drawn layer is still the selection, so nudge it directly. (Selecting it
  // from the layers panel is not an option here: opening the File panel replaces
  // the left panel's content, so there are no layer rows to click.)
  await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(500);

  await openFilePanel(page);
  await page.locator('[aria-label="Compare with Before move"]').click();
  await page.waitForTimeout(600);

  // The panel reports the change and the canvas highlights it.
  await expect(page.locator('.app__left')).toContainText('1 changed');
  await expect(overlay(page), 'no compare overlay was rendered').toHaveCount(1);
  await expect(highlights(page, 'changed'), 'the moved layer was not highlighted as changed').toHaveCount(1);
  await expect(highlights(page, 'added'), 'a move must not appear as an addition').toHaveCount(0);
  await expect(highlights(page, 'removed'), 'a move must not appear as a removal').toHaveCount(0);
  await expect(page.locator('[data-testid="compare-legend"]')).toBeVisible();
});

test('B52b added and removed layers are highlighted with their own kind', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 160, 120);
  await saveVersion(page, 'Base');

  await page.locator('.rail__button[aria-label="File"]').click();
  await page.waitForTimeout(300);
  // The rectangle is still selected: delete it (a REMOVAL), then draw an ellipse
  // (an ADDITION), so both kinds exist at once.
  // Wait on the CONDITION, not a sleep: the delete and the draw are both async,
  // and a fixed pause here made this test pass or fail on machine load.
  await page.keyboard.press('Delete');
  await expect.poll(() => shapeTypes(page), { timeout: 10000 }).toEqual([]);

  await drawShape(page, 'Ellipse', 100, 100, 180, 0);
  await expect
    .poll(() => shapeTypes(page), { timeout: 10000 })
    .toEqual(['ELLIPSE']);

  await openFilePanel(page);
  await page.locator('[aria-label="Compare with Base"]').click();
  await page.waitForTimeout(600);

  await expect(highlights(page, 'added'), 'the new ellipse was not highlighted as added').not.toHaveCount(0);
  await expect(highlights(page, 'removed'), 'the deleted rectangle was not highlighted as removed').not.toHaveCount(0);
});

test('B52c comparing adds NO history entry, and neither does leaving compare', async ({ page }) => {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 160, 120);
  await saveVersion(page, 'Base');

  await page.locator('.rail__button[aria-label="File"]').click();
  await page.waitForTimeout(300);
  await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(500);

  const before = await historyDepth(page);

  await openFilePanel(page);
  await page.locator('[aria-label="Compare with Base"]').click();
  await page.waitForTimeout(600);
  await expect(overlay(page)).toHaveCount(1);

  const during = await historyDepth(page);
  expect(during, 'entering compare pushed a history entry').toBe(before);

  // Leaving compare is also a view change only.
  await page.locator('[aria-label="Exit version compare"]').first().click();
  await page.waitForTimeout(500);
  expect(await historyDepth(page), 'leaving compare pushed a history entry').toBe(before);

  // The highlight is gone and the live document is back... but the move survived,
  // so a single undo must revert the move, not the compare.
  await expect(overlay(page)).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(500);
  expect(await historyDepth(page), 'a single undo after compare did not undo the move').toBe(before - 1);
});
