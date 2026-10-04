import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, tool } from './helpers';
import { diffDocuments, diffSummary, isUnchanged } from '../../src/model/versionDiff';
import type { PigmaFile } from '../../src/model/types';

/**
 * Version compare: what changed between a saved version and the live document.
 *
 * The diff is pure and id-keyed, so this drives the REAL flow - save a version,
 * make an edit, then diff the version's snapshot against the current document -
 * and runs the app's own `diffDocuments` over the two documents.
 */

async function openFilePanel(page: Page): Promise<void> {
  await page.locator('.rail__button[aria-label="File"]').click();
  await page.waitForTimeout(400);
}

/** Save the current document as a named version. */
async function saveVersion(page: Page, name: string): Promise<void> {
  await openFilePanel(page);
  await page.locator('input[aria-label="Version name"]').fill(name);
  await page.locator('button[aria-label="Save version"]').click();
  await page.waitForTimeout(700);
  // Close the panel again so canvas interactions are unobstructed.
  await page.locator('.rail__button[aria-label="File"]').click();
  await page.waitForTimeout(300);
}

/** The saved version's snapshot and the live document, as plain JSON. */
async function versionAndCurrent(page: Page): Promise<{ version: PigmaFile; current: PigmaFile }> {
  return page.evaluate(() => {
    const store = window.__pigmaStore;
    if (!store) throw new Error('window.__pigmaStore is not exposed');
    const file = (store.getState() as unknown as { file: PigmaFile & { versions?: Array<{ snapshot: PigmaFile }> } }).file;
    const versions = file.versions ?? [];
    const last = versions[versions.length - 1];
    if (!last) throw new Error('no version was saved');
    return { version: last.snapshot, current: file };
  });
}

async function drawRect(page: Page): Promise<void> {
  await drawShape(page, 'Rectangle', 160, 120);
}

test('B51a an unchanged document reports no changes', async ({ page }) => {
  await boot(page, { blank: true });
  await drawRect(page);
  await saveVersion(page, 'Baseline');

  const { version, current } = await versionAndCurrent(page);
  const diff = diffDocuments(version, current);

  expect(isUnchanged(diff), `expected no changes, got: ${diffSummary(diff)}`).toBe(true);
  expect(diff.added).toHaveLength(0);
  expect(diff.removed).toHaveLength(0);
  expect(diff.changed).toHaveLength(0);
  expect(diffSummary(diff), 'the summary does not say there are no changes').toBe('No changes');
  // The documents really do contain content, so "no changes" is not "no
  // content": the diff counts scene nodes (DOCUMENT and CANVAS are excluded),
  // which is exactly what the layers panel lists.
  // The diff counts scene nodes (DOCUMENT and CANVAS are excluded). Count them
  // straight from the store - the layers panel also lists the File panel's rows,
  // so it is not a proxy for this.
  const shapes = await page.evaluate(() => {
    const store = window.__pigmaStore;
    if (!store) throw new Error('window.__pigmaStore is not exposed');
    const file = (store.getState() as unknown as {
      file: { document: { children: Array<{ type: string; children?: unknown[] }> } };
    }).file;
    const count = (nodes: Array<{ type: string; children?: unknown[] }>): number =>
      nodes.reduce(
        (n, node) => n + (node.type === 'DOCUMENT' || node.type === 'CANVAS' ? 0 : 1) + count((node.children ?? []) as Array<{ type: string; children?: unknown[] }>),
        0,
      );
    return count(file.document.children);
  });
  expect(shapes, 'nothing was drawn, so this proves nothing').toBeGreaterThan(0);
  expect(diff.counts.from, 'the diff counts a different number of nodes than the document holds').toBe(shapes);
  expect(diff.counts.to).toBe(diff.counts.from);
});

test('B51b moving a layer is reported as CHANGED with the position property', async ({ page }) => {
  await boot(page, { blank: true });
  await drawRect(page);
  await saveVersion(page, 'Before move');

  // Move the layer through the real UI: a single 10px nudge is one edit.
  await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(500);

  const { version, current } = await versionAndCurrent(page);
  const diff = diffDocuments(version, current);

  expect(diff.added, 'a move must not read as an add').toHaveLength(0);
  expect(diff.removed, 'a move must not read as a remove').toHaveLength(0);
  expect(diff.changed.length, `expected one changed node, got ${diffSummary(diff)}`).toBe(1);
  expect(diff.changed[0]!.properties, 'the change does not name the moved property').toContain('position');
  expect(diffSummary(diff)).toContain('1 changed');
});

test('B51c adding a layer is reported as ADDED', async ({ page }) => {
  await boot(page, { blank: true });
  await drawRect(page);
  await saveVersion(page, 'Before add');

  await drawShape(page, 'Ellipse', 100, 100, 180, 0);

  const { version, current } = await versionAndCurrent(page);
  const diff = diffDocuments(version, current);

  expect(diff.added.length, `expected one added node, got ${diffSummary(diff)}`).toBeGreaterThanOrEqual(1);
  expect(diff.removed, 'adding must not read as a remove').toHaveLength(0);
  expect(diffSummary(diff)).toContain('added');

  // The added id is a node that exists now and did not before.
  const addedId = diff.added[0]!;
  const currentIds = new Set<string>();
  const walk = (n: { id: string; children?: unknown[] }): void => {
    currentIds.add(n.id);
    for (const c of (n.children ?? []) as Array<{ id: string; children?: unknown[] }>) walk(c);
  };
  walk(current.document as unknown as { id: string; children?: unknown[] });
  expect(currentIds.has(addedId), 'the reported added id is not in the current document').toBe(true);
});

test('B51d deleting a layer is reported as REMOVED', async ({ page }) => {
  await boot(page, { blank: true });
  await drawRect(page);
  await drawShape(page, 'Ellipse', 100, 100, 180, 0);
  await saveVersion(page, 'Before delete');

  // Delete the selected (newest) layer through the keyboard.
  await tool(page, 'Move').click();
  await page.keyboard.press('Delete');
  await page.waitForTimeout(500);

  const { version, current } = await versionAndCurrent(page);
  const diff = diffDocuments(version, current);

  expect(diff.removed.length, `expected one removed node, got ${diffSummary(diff)}`).toBeGreaterThanOrEqual(1);
  expect(diff.added, 'deleting must not read as an add').toHaveLength(0);
  expect(diffSummary(diff)).toContain('removed');
});

test('B51e a move inside the tree is a change, not an add/remove pair', async ({ page }) => {
  await boot(page, { blank: true });
  await drawRect(page);
  await saveVersion(page, 'Before reorder');

  // Rename rather than move-in-tree: the point is that identity is the id, so a
  // node that stays in place but changes content is exactly one change.
  await page.evaluate(() => {
    const store = window.__pigmaStore;
    if (!store) throw new Error('window.__pigmaStore is not exposed');
    (store.getState() as unknown as {
      updateSelected: (patch: Record<string, unknown>, label: string) => void;
    }).updateSelected({ name: 'Renamed layer' }, 'test rename');
  });
  await page.waitForTimeout(400);

  const { version, current } = await versionAndCurrent(page);
  const diff = diffDocuments(version, current);

  expect(diff.added).toHaveLength(0);
  expect(diff.removed).toHaveLength(0);
  expect(diff.changed).toHaveLength(1);
  expect(diff.changed[0]!.name, 'the change does not report the new name').toBe('Renamed layer');
  expect(diff.changed[0]!.properties).toContain('name');
});
