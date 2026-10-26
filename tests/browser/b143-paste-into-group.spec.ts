/**
 * Paste into an entered group: the copy is centred on the group's own content (Sketch's Edinburgh release: pasting
 * into a group centres the content). Before this the copy kept the place it was copied from, so it could land outside
 * the group. The centring is unit-tested (instantiateClipboardCentred in ops.test.ts); this drives the live editor.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, nextPaint, tool } from './helpers';

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
  await page.keyboard.press('ControlOrMeta+v');
  await nextPaint(page);
  // The paste must have added a copy to the group. If it did not, the copy check below reads the source rectangle, which is
  // the first-attempt failure seen under full-suite load; this makes that case name itself.
  await expect.poll(() =>
    page.evaluate(() => {
      const kids = window.__pigmaStore!.getState().file.document.children[0]!.children as Array<{ type: string; children?: unknown[] }>;
      return kids.find((node) => node.type === 'GROUP')!.children!.length;
    }),
  ).toBe(3);

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
