/**
 * Paste into an entered group: the copy is centred on the group's own content (Sketch's Edinburgh release: pasting
 * into a group centres the content). Before this the copy kept the place it was copied from, so it could land outside
 * the group. The centring is unit-tested (instantiateClipboardCentred in ops.test.ts); this drives the live editor.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, nextPaint, tool } from './helpers';

/** The entered group's children and the clipboard's nodes, by type and name: the state a paste is checked against. */
async function snapshot(page: Page) {
  return page.evaluate(() => {
    const state = window.__pigmaStore!.getState();
    const group = state.file.document.children[0]!.children.find((child) => child.type === 'GROUP') as unknown as
      | { children: Array<{ type: string; name: string }> }
      | undefined;
    const describe = (node: { type: string; name: string }) => ({ type: node.type, name: node.name });
    return {
      group: (group?.children ?? []).map(describe),
      clipboard: (state.clipboard ?? []).map(describe),
    };
  });
}

/** Two rectangles grouped, with a small rectangle far away copied to the clipboard. */
async function groupedWithCopy(page: Page) {
  await boot(page, { blank: true });
  await drawShape(page, 'Rectangle', 100, 100, -150, 0);
  await drawShape(page, 'Rectangle', 100, 100, 150, 0);
  await tool(page, 'Move').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+g');
  await nextPaint(page);
  await drawShape(page, 'Rectangle', 40, 40, 0, -300);
  // Copy only once the new rectangle is the selection, so the clipboard holds it and not the group.
  await expect(page.locator('.layer-row--selected', { hasText: 'Rectangle 3' })).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+c');
  await expect.poll(() => page.evaluate(() => window.__pigmaStore!.getState().clipboard?.length ?? 0)).toBe(1);
}

test('B143a pasting into an entered group centres the copy on the group content', async ({ page }) => {
  await groupedWithCopy(page);
  // Both centres come from the store, the source the paste itself uses: the panel can lag a selection change, and a stale
  // read made this spec fail on its first attempt under load.
  const groupCentre = await page.evaluate(() => {
    const kids = window.__pigmaStore!.getState().file.document.children[0]!.children as Array<{ type: string; children?: Array<{ transform: { tx: number; ty: number }; width: number; height: number }> }>;
    const group = kids.find((node) => node.type === 'GROUP')!;
    const children = group.children!;
    const minX = Math.min(...children.map((c) => c.transform.tx));
    const minY = Math.min(...children.map((c) => c.transform.ty));
    const maxX = Math.max(...children.map((c) => c.transform.tx + c.width));
    const maxY = Math.max(...children.map((c) => c.transform.ty + c.height));
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  });

  await page.evaluate(() => {
    const state = window.__pigmaStore!.getState();
    const group = state.file.document.children[0]!.children.find((child) => child.type === 'GROUP')!;
    state.setEnteredContainer(group.id);
  });
  // Before the paste: what the group holds and what the clipboard holds. A group that already has an extra child, or a clipboard
  // that is not the one rectangle copied, shows here rather than as a bare count after the paste.
  const before = await snapshot(page);
  expect(before.group.map((child) => child.type), `the group before the paste: ${JSON.stringify(before)}`).toEqual(['RECTANGLE', 'RECTANGLE']);
  expect(before.clipboard.map((node) => node.type), `the clipboard before the paste: ${JSON.stringify(before)}`).toEqual(['RECTANGLE']);

  await page.keyboard.press('ControlOrMeta+v');
  await nextPaint(page);
  // The paste must have added a copy to the group. If it did not, the copy check below reads the source rectangle, which is
  // the first-attempt failure seen under full-suite load. The message carries both snapshots, so a wrong count names its cause.
  let after = await snapshot(page);
  const deadline = Date.now() + 5000;
  while (after.group.length !== 3 && Date.now() < deadline) {
    await page.waitForTimeout(100);
    after = await snapshot(page);
  }
  expect(after.group.length, `the group after the paste, before ${JSON.stringify(before)}, after ${JSON.stringify(after)}`).toBe(3);

  // The copy is the selection after the paste. Poll until it has settled at the group's centre.
  await expect.poll(() =>
    page.evaluate((target) => {
      const id = window.__pigmaStore!.getState().selection[0];
      const find = (nodes: Array<{ id: string; transform: { tx: number; ty: number }; width: number; height: number; children?: unknown[] }>): { transform: { tx: number; ty: number }; width: number; height: number } | null => {
        for (const node of nodes) {
          if (node.id === id) return node;
          const inside = node.children ? find(node.children as typeof nodes) : null;
          if (inside) return inside;
        }
        return null;
      };
      const copy = find(window.__pigmaStore!.getState().file.document.children[0]!.children as never);
      if (!copy) return Infinity;
      return Math.hypot(copy.transform.tx + copy.width / 2 - target.x, copy.transform.ty + copy.height / 2 - target.y);
    }, groupCentre),
  ).toBeLessThan(0.5);
});
