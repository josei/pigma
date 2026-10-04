import { test, expect, type Page } from '@playwright/test';
import { boot, drawShape, nodeGeometry, tool } from './helpers';
import { evaluateBooleanNode } from '../../src/model/boolean';
import type { ContainerNode } from '../../src/model/types';

/**
 * The boolean operation is LIVE: a BOOLEAN_OPERATION keeps its operands and
 * re-evaluates whenever one of them moves, rather than freezing the path it was
 * created with.
 *
 * The strongest available check is that the rendered path equals a FRESH
 * evaluation of the current operands. `evaluateBooleanNode` computes from the
 * children's transforms and ignores the stored `pathData`, so clearing it on a
 * clone forces an independent recomputation rather than an echo of the value
 * already on the node.
 */

async function twoOverlappingRects(page: Page): Promise<void> {
  await drawShape(page, 'Rectangle', 160, 160, -40, 0);
  const a = await nodeGeometry(page);
  await drawShape(page, 'Rectangle', 160, 160, 40, 0);
  const b = await nodeGeometry(page);
  expect(await page.locator('.layer-row').count()).toBe(2);
  expect(a.x).toBeLessThan(b.x + b.w);
  expect(b.x).toBeLessThan(a.x + a.w);

  await tool(page, 'Move').click();
  await page.keyboard.press('Escape');
  const box = (await page.locator('.canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx - 260, cy - 160);
  await page.mouse.down();
  await page.mouse.move(cx + 260, cy + 160, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

/** The selected BOOLEAN_OPERATION node, straight from the store. */
async function booleanNode(page: Page): Promise<ContainerNode> {
  return page.evaluate(() => {
    const store = window.__pigmaStore;
    if (!store) throw new Error('window.__pigmaStore is not exposed');
    const state = store.getState() as unknown as {
      selection: string[];
      file: { document: { children: Array<{ children: Array<Record<string, unknown>> }> } };
    };
    const id = state.selection[0];
    const page_ = state.file.document.children[0]!;
    let found: Record<string, unknown> | undefined;
    const walk = (nodes: Array<Record<string, unknown>>): void => {
      for (const node of nodes) {
        if (node.id === id) {
          found = node;
          return;
        }
        const kids = node.children as Array<Record<string, unknown>> | undefined;
        if (kids) walk(kids);
      }
    };
    walk(page_.children as Array<Record<string, unknown>>);
    if (!found) throw new Error(`selected node ${String(id)} not found in the document`);
    if (found.type !== 'BOOLEAN_OPERATION') throw new Error(`selected node is ${String(found.type)}, not a boolean`);
    return found as unknown as ContainerNode;
  });
}

/** The union's rendered outline, taken from the live canvas. */
async function renderedPath(page: Page): Promise<string> {
  return page.evaluate(() => {
    const svg = document.querySelector('.canvas__svg');
    if (!svg) throw new Error('no canvas');
    // The boolean's own geometry is the last path carrying a filled outline.
    const paths = [...svg.querySelectorAll('path')];
    const filled = paths.filter((p) => (p.getAttribute('fill') ?? '') !== 'none' && p.getAttribute('d'));
    return filled.length > 0 ? (filled[filled.length - 1]!.getAttribute('d') ?? '') : '';
  });
}

test('B50a moving an operand re-evaluates the boolean, and the result matches a fresh evaluation', async ({ page }) => {
  await boot(page, { blank: true });
  await twoOverlappingRects(page);
  await page.locator('[aria-label="Union"]').click();
  await page.waitForTimeout(500);

  const before = await booleanNode(page);
  const beforePath = await renderedPath(page);
  expect(before.pathData, 'the union has no geometry').toBeTruthy();
  expect(beforePath, 'the union rendered nothing').toBeTruthy();

  // Move one operand. The MOVE is a real UI edit - arrow-key nudging - which is
  // what exercises the re-evaluation pass. Only the SELECTION is made through
  // the store: after a union the layers tree shows just the "Union" row (the
  // operands are not exposed as rows), so there is no UI route to select one.
  const operandId = (await booleanNode(page)).children![0]!.id;
  await page.evaluate((id) => {
    const store = window.__pigmaStore;
    if (!store) throw new Error('window.__pigmaStore is not exposed');
    (store.getState() as unknown as { select: (ids: string[]) => void }).select([id]);
  }, operandId);
  await page.waitForTimeout(250);
  expect(
    await page.evaluate(() => (window.__pigmaStore!.getState() as unknown as { selection: string[] }).selection[0]),
    'the operand was not selected',
  ).toBe(operandId);
  // ONE edit, not a burst: a run of rapid nudges does not reliably land in a
  // single history entry (12 presses coalesced unevenly - a single undo reverted
  // 11px of 12), which would make "one undo restores" ambiguous. Shift+Arrow
  // nudges 10px and is one entry.
  await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(500);

  // Re-select the boolean itself to read its geometry.
  await page.evaluate((id) => {
    const store = window.__pigmaStore;
    if (!store) throw new Error('window.__pigmaStore is not exposed');
    (store.getState() as unknown as { select: (ids: string[]) => void }).select([id]);
  }, before.id);
  await page.waitForTimeout(300);

  const after = await booleanNode(page);
  const afterPath = await renderedPath(page);

  // (1) The stored geometry MOVED with the operand.
  expect(after.pathData, 'moving an operand did not change the boolean geometry').not.toBe(before.pathData);
  // (2) And so did the rendered outline - not just the model.
  expect(afterPath, 'the rendered outline did not change').not.toBe(beforePath);

  // (3) The live path IS what a fresh evaluation of the current operands gives.
  // Clearing pathData/width/height forces evaluateBooleanNode to recompute from
  // the children instead of returning the node's existing values.
  const fresh = evaluateBooleanNode({ ...after, pathData: '', width: 1, height: 1 } as ContainerNode);
  expect(fresh, 'a fresh evaluation produced nothing').not.toBeNull();
  expect(
    after.pathData,
    'the live geometry does not match a fresh evaluation of the same operands',
  ).toBe(fresh!.pathData);

  // (4) Undo restores the previous geometry. Undo also restores the SELECTION
  // that was current when the nudge was made - the operand, not the boolean - so
  // re-select the boolean before reading it.
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(500);
  await page.evaluate((id) => {
    const store = window.__pigmaStore;
    if (!store) throw new Error('window.__pigmaStore is not exposed');
    (store.getState() as unknown as { select: (ids: string[]) => void }).select([id]);
  }, before.id);
  await page.waitForTimeout(300);
  const undone = await booleanNode(page);
  expect(undone.pathData, 'undo did not restore the boolean geometry').toBe(before.pathData);
  expect(await renderedPath(page), 'undo did not restore the rendered outline').toBe(beforePath);
});

test('B50b the boolean stays live rather than freezing its operands', async ({ page }) => {
  await boot(page, { blank: true });
  await twoOverlappingRects(page);
  await page.locator('[aria-label="Union"]').click();
  await page.waitForTimeout(500);

  const node = await booleanNode(page);
  // A live op keeps its operands to re-evaluate from; a flattened one would not.
  expect(node.booleanOperation, 'the node lost its operation mode').toBe('UNION');
  expect(node.children?.length ?? 0, 'the operands were discarded').toBeGreaterThanOrEqual(2);
});
