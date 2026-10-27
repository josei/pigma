/**
 * Grid auto layout (Figma's third flow).
 *
 * Geometry, not markup: every assertion is on the resolved track sizes, the gaps
 * and the cells children land in, because that is what "grid" means. The pass runs
 * through `reflowTree`, the same choke point the row/column flows use, so a grid
 * parent re-lays-out when it or a child changes.
 */
import { describe, expect, it } from 'vitest';
import { emptyFile } from './validate';
import { parseFile, serializeFile } from './serialize';
import { createFrameNode, createRectNode } from './factory';
import { gridRowCount, reflowTree, setGridShare } from './autoLayout';
import { settleDocument } from './settle';
import { findNode, updateNode } from './tree';
import type { AutoLayout, ContainerNode, GridTrackSize, PigmaFile, SceneNode } from './types';
import { solidPaint } from './paint';

const FIXED = (value: number): GridTrackSize => ({ type: 'FIXED', value });
const FLEX = (value: number): GridTrackSize => ({ type: 'FLEX', value });

/** A grid frame with `count` 40x30 children, width/height as given. */
function grid(width: number, height: number, count: number, layout: Partial<AutoLayout>): { file: PigmaFile; id: string } {
  const file = emptyFile('Grid');
  const page = file.document.children[0]!;
  const frame = createFrameNode(file.document, 0, 0, width, height);
  frame.autoLayout = {
    layoutMode: 'GRID',
    primaryAxisSizingMode: 'FIXED',
    counterAxisSizingMode: 'FIXED',
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    ...layout,
  };
  frame.children = Array.from({ length: count }, (_, index) => {
    const child = createRectNode(file.document, 0, 0, 40, 30);
    child.name = `Cell ${index}`;
    return child;
  });
  page.children = [frame];
  return { file, id: frame.id };
}

const childrenOf = (file: PigmaFile, id: string): SceneNode[] => (findNode(file.document, id) as ContainerNode).children as SceneNode[];

describe('grid auto layout', () => {
  it('distributes fixed and fractional tracks, then places children in cells', () => {
    // 400 wide, 3 columns: 100px fixed + 1fr + 2fr, 20px gaps.
    // Leftover = 400 - 100 - 40 = 260, split 1:2 -> 86.67 / 173.33.
    const { file, id } = grid(400, 200, 3, { gridColumns: [FIXED(100), FLEX(1), FLEX(2)], gridColumnGap: 20, gridRowGap: 10 });
    const laid = reflowTree(file.document);
    const cells = childrenOf({ ...file, document: laid }, id);
    expect(cells[0]!.transform.tx).toBeCloseTo(0, 3);
    expect(cells[0]!.width).toBeCloseTo(100, 3);
    expect(cells[1]!.transform.tx).toBeCloseTo(120, 3);
    expect(cells[1]!.width).toBeCloseTo(260 / 3, 3);
    expect(cells[2]!.transform.tx).toBeCloseTo(120 + 260 / 3 + 20, 3);
    expect(cells[2]!.width).toBeCloseTo((260 * 2) / 3, 3);
    // The frame's own size is untouched: its axes are FIXED.
    expect((findNode(laid, id) as ContainerNode).width).toBe(400);
  });

  it('does not let a fixed track absorb fractional space', () => {
    const { file, id } = grid(300, 100, 2, { gridColumns: [FIXED(100), FLEX(1)], gridColumnGap: 0 });
    const laid = reflowTree(file.document);
    const cells = childrenOf({ ...file, document: laid }, id);
    expect(cells[0]!.width, 'the fixed track must stay 100').toBe(100);
    expect(cells[1]!.width, 'the fractional track takes the rest').toBe(200);
  });

  it('honours a span, including its share of the gaps', () => {
    const { file, id } = grid(300, 200, 3, { gridColumns: [FLEX(1), FLEX(1), FLEX(1)], gridColumnGap: 10, gridRowGap: 10 });
    const page = file.document.children[0]!;
    const frame = findNode(file.document, id) as ContainerNode;
    (frame.children as SceneNode[])[1]!.gridColumnSpan = 2;
    page.children = [frame];
    const laid = reflowTree(file.document);
    const cells = childrenOf({ ...file, document: laid }, id);
    // 300 wide, two gaps of 10: tracks are (300 - 20) / 3 = 93.33 each.
    // The spanning child covers two tracks plus the gap between them.
    expect(cells[1]!.width).toBeCloseTo(93.33 * 2 + 10, 1);
    expect(cells[1]!.transform.tx).toBeCloseTo(103.33, 1);
    // Auto-placement puts the third child after the span, on the same row only if
    // it fits: 2 + 1 tracks = 3, so it lands in the third column.
    expect(cells[2]!.transform.tx).toBeCloseTo(206.67, 1);
  });

  it('keeps a manual placement in its cell while auto-placement flows around it', () => {
    const { file, id } = grid(300, 200, 4, { gridColumns: [FLEX(1), FLEX(1), FLEX(1)], gridColumnGap: 0, gridRowGap: 0 });
    const frame = findNode(file.document, id) as ContainerNode;
    const cells = frame.children as SceneNode[];
    // Pin the LAST child to the first cell. Auto-placement must skip that cell,
    // so the first three children move along instead of overwriting it.
    cells[3]!.gridColumnAnchorIndex = 0;
    cells[3]!.gridRowAnchorIndex = 0;
    const laid = reflowTree(file.document);
    const placed = childrenOf({ ...file, document: laid }, id);
    expect(placed[3]!.transform.tx, 'the manual cell must be preserved').toBe(0);
    expect(placed[3]!.transform.ty).toBe(0);
    expect(placed[0]!.transform.tx, 'auto-placement flows around it').toBeCloseTo(100, 3);
    expect(placed[1]!.transform.tx).toBeCloseTo(200, 3);
    // Two rows of 100 for a 200-tall grid, so the wrap lands on the second row.
    expect(placed[2]!.transform.ty, 'and wraps to the next row').toBeCloseTo(100, 3);
  });

  it('dense placement fills a hole a spanning child leaves behind', () => {
    // Three 1fr columns and two 1fr rows. Child 0 takes cell (0,0); child 1 spans the
    // whole row, so it drops to row 1 and row 0 keeps a hole at columns 1-2. Child 2 is
    // one cell wide: dense puts it in that hole, where sparse would walk past it.
    const { file, id } = grid(300, 200, 3, { gridColumns: [FLEX(1), FLEX(1), FLEX(1)], gridRows: [FLEX(1), FLEX(1)], gridDense: true });
    const frame = findNode(file.document, id) as ContainerNode;
    (frame.children[1] as SceneNode).gridColumnSpan = 3;
    const laid = childrenOf({ ...file, document: reflowTree(file.document) }, id);
    expect(laid[1]!.transform.ty, 'the spanning child did not drop to row 1').toBeCloseTo(100, 3);
    expect(laid[2]!.transform.ty, 'dense did not reuse the hole in row 0').toBeCloseTo(0, 3);
    expect(laid[2]!.transform.tx).toBeCloseTo(100, 3);
  });

  it('sizes each declared row on its own: a fixed row takes its pixels and the fractional row takes the rest', () => {
    // 200 tall, rows 50px fixed then 1fr, no gap: the 1fr row gets the 150px left over.
    // Figma's gridRowSizes is this per-row choice (FIXED or FLEX) in our model.
    const { file, id } = grid(300, 200, 2, { gridColumns: [FLEX(1)], gridRows: [FIXED(50), FLEX(1)] });
    const laid = childrenOf({ ...file, document: reflowTree(file.document) }, id);
    expect(laid[0]!.transform.ty, 'the fixed row did not start at the top').toBeCloseTo(0, 3);
    expect(laid[1]!.transform.ty, 'the fractional row did not start after the 50px row').toBeCloseTo(50, 3);
  });

  it('counts the rows a grid uses, including the implicit ones the children need', () => {
    // Two columns, three children, no declared rows: the children wrap onto two rows.
    const { file, id } = grid(300, 200, 3, { gridColumns: [FLEX(1), FLEX(1)] });
    const frame = findNode(file.document, id) as ContainerNode;
    expect(gridRowCount(frame.children as SceneNode[], frame.autoLayout as AutoLayout)).toBe(2);
    // A declared list longer than the children keeps its rows.
    expect(gridRowCount(frame.children as SceneNode[], { ...(frame.autoLayout as AutoLayout), gridRows: [FLEX(1), FLEX(1), FLEX(1)] })).toBe(3);
  });

  it('re-lays-out when the frame is resized', () => {
    const { file, id } = grid(300, 100, 2, { gridColumns: [FIXED(100), FLEX(1)], gridColumnGap: 0 });
    const wide = reflowTree(file.document);
    expect(childrenOf({ ...file, document: wide }, id)[1]!.width).toBe(200);

    // Resize the frame: the fractional track takes the new leftover.
    const resized = {
      ...file,
      document: {
        ...file.document,
        children: [
          { ...(file.document.children[0] as unknown as ContainerNode), children: [findNode(wide, id)!] },
          ...file.document.children.slice(1),
        ],
      },
    } as PigmaFile;
    const frame = findNode(resized.document, id) as unknown as ContainerNode;
    (frame as unknown as { width: number }).width = 500;
    const laid = reflowTree(resized.document);
    expect(childrenOf({ ...resized, document: laid }, id)[1]!.width).toBe(400);
  });

  it('hugs its content when an axis is AUTO', () => {
    // Two flex columns, content 40 wide each: a hugging grid is 80 wide, and a
    // hugging height fits the single row.
    const { file, id } = grid(10, 10, 2, { primaryAxisSizingMode: 'AUTO', counterAxisSizingMode: 'AUTO', gridColumns: [FLEX(1), FLEX(1)], gridColumnGap: 0, gridRowGap: 0 });
    const laid = reflowTree(file.document);
    const frame = findNode(laid, id) as ContainerNode;
    expect(frame.width).toBeCloseTo(80, 3);
    expect(frame.height).toBeCloseTo(30, 3);
  });

  it('runs from settleDocument, so no write path can forget it', () => {
    const { file, id } = grid(400, 200, 3, { gridColumns: [FIXED(100), FLEX(1), FLEX(2)], gridColumnGap: 20 });
    const settled = settleDocument(file);
    const cells = childrenOf(settled, id);
    expect(cells[1]!.width).toBeCloseTo(260 / 3, 3);
    // Idempotent: settling again changes nothing.
    expect(settleDocument(settled)).toBe(settled);
  });

  it('round-trips the grid model through JSON', () => {
    const { file, id } = grid(300, 100, 2, { gridColumns: [FIXED(80), FLEX(2)], gridRows: [FLEX(1)], gridColumnGap: 12, gridRowGap: 6 });
    const frame = findNode(file.document, id) as ContainerNode;
    (frame.children as SceneNode[])[0]!.gridColumnSpan = 1;
    (frame.children as SceneNode[])[0]!.gridRowAnchorIndex = 0;
    const reloaded = parseFile(serializeFile(file)).file!;
    const layout = (findNode(reloaded.document, id) as ContainerNode).autoLayout!;
    expect(layout.layoutMode).toBe('GRID');
    expect(layout.gridColumns).toEqual([FIXED(80), FLEX(2)]);
    expect(layout.gridRows).toEqual([FLEX(1)]);
    expect(layout.gridColumnGap).toBe(12);
    expect(layout.gridRowGap).toBe(6);
    const child = (findNode(reloaded.document, id) as ContainerNode).children[0]!;
    expect(child.gridRowAnchorIndex).toBe(0);
  });

  it('drops a malformed track list rather than laying out with it', () => {
    const { file, id } = grid(300, 100, 2, { gridColumns: [FIXED(100), FLEX(1)] });
    const text = JSON.parse(serializeFile(file)) as { document: { children: Array<{ children: Array<Record<string, unknown>> }> } };
    const frame = text.document.children[0]!.children[0]! as { autoLayout: Record<string, unknown> };
    frame.autoLayout.gridColumns = 'nonsense';
    const reloaded = parseFile(JSON.stringify(text)).file!;
    const layout = (findNode(reloaded.document, id) as ContainerNode).autoLayout!;
    expect(layout.gridColumns, 'a malformed list must not survive').toBeUndefined();
    // And the layout still runs, with the single implicit column.
    const laid = reflowTree(reloaded.document);
    expect(childrenOf({ ...reloaded, document: laid }, id)[0]!.width).toBeCloseTo(300, 3);
  });

  it('with Include stroke in layout, a cell is the stroke box and the child fills it less the stroke', () => {
    const layout = { gridColumns: [FLEX(1), FLEX(1)], gridRows: [FLEX(1)], gridColumnGap: 12, strokesIncludedInLayout: true };
    const { file, id } = grid(600, 400, 2, layout);
    const frame = findNode(file.document, id) as ContainerNode;
    for (const child of frame.children) {
      child.strokes = [solidPaint({ r: 0, g: 0, b: 0 })];
      child.strokeWeight = 10;
      child.strokeAlign = 'CENTER';
    }
    const [first, second] = (findNode(reflowTree(file.document), id) as ContainerNode).children;
    // Two columns of (600 - 12) / 2 = 294. Each child is 294 less the 5px per side, placed 5px in from its cell.
    expect(first!.transform.tx).toBeCloseTo(5, 0);
    expect(first!.width).toBeCloseTo(284, 0);
    expect(second!.transform.tx).toBeCloseTo(311, 0);
    expect(second!.width).toBeCloseTo(284, 0);
  });

  it('with the flag off, the same strokes leave the grid unchanged', () => {
    const { file, id } = grid(600, 400, 2, { gridColumns: [FLEX(1), FLEX(1)], gridRows: [FLEX(1)], gridColumnGap: 12 });
    const frame = findNode(file.document, id) as ContainerNode;
    for (const child of frame.children) {
      child.strokes = [solidPaint({ r: 0, g: 0, b: 0 })];
      child.strokeWeight = 10;
      child.strokeAlign = 'CENTER';
    }
    const [first, second] = (findNode(reflowTree(file.document), id) as ContainerNode).children;
    expect(first!.transform.tx).toBeCloseTo(0, 0);
    expect(first!.width).toBeCloseTo(294, 0);
    expect(second!.transform.tx).toBeCloseTo(306, 0);
    expect(second!.width).toBeCloseTo(294, 0);
  });
});


describe('grid cell share', () => {
  it('a child takes its percent of its cell, at the start of the cell', () => {
    // 400 wide, one column of 200 and one of 200, 20px gaps: the first cell is 200 wide, and a 50 percent share is 100.
    const { file, id } = grid(400, 200, 2, { gridColumns: [FIXED(200), FIXED(200)], gridColumnGap: 20, gridRowGap: 0, gridRows: [FIXED(100)] });
    const [first] = childrenOf(file, id);
    const shared = setGridShare(file, [first!.id], 'width', 50);
    const cells = childrenOf({ ...shared, document: reflowTree(shared.document) }, id);
    expect(cells[0]!.width).toBeCloseTo(100, 3);
    expect(cells[0]!.transform.tx).toBeCloseTo(0, 3);
    // The second child still fills its own cell.
    expect(cells[1]!.width).toBeCloseTo(200, 3);
  });

  it('a height share takes its percent of the cell height', () => {
    const { file, id } = grid(400, 200, 1, { gridColumns: [FIXED(200)], gridRows: [FIXED(100)] });
    const [only] = childrenOf(file, id);
    const shared = setGridShare(file, [only!.id], 'height', 40);
    expect((childrenOf({ ...shared, document: reflowTree(shared.document) }, id)[0] as SceneNode).height).toBeCloseTo(40, 3);
  });

  it('a share is clamped to the child\'s own maximum, and 0 clears it', () => {
    const { file, id } = grid(400, 200, 1, { gridColumns: [FIXED(200)], gridRows: [FIXED(100)] });
    const [only] = childrenOf(file, id);
    const limited = { ...file, document: updateNode(file.document, only!.id, (node) => ({ ...node, maxWidth: 30 }) as SceneNode) };
    const shared = setGridShare(limited, [only!.id], 'width', 80);
    expect((childrenOf({ ...shared, document: reflowTree(shared.document) }, id)[0] as SceneNode).width).toBe(30);
    const cleared = setGridShare(shared, [only!.id], 'width', 0);
    expect((findNode(cleared.document, only!.id) as SceneNode).gridWidthPercent).toBeUndefined();
    expect((childrenOf({ ...cleared, document: reflowTree(cleared.document) }, id)[0] as SceneNode).width).toBe(200);
  });

  it('a hugging grid axis turns Fixed when a share is set, and a child of a row is left as it is', () => {
    const { file, id } = grid(400, 200, 1, { gridColumns: [FIXED(200)], gridRows: [FIXED(100)], primaryAxisSizingMode: 'AUTO' });
    const [only] = childrenOf(file, id);
    const shared = setGridShare(file, [only!.id], 'width', 50);
    expect((findNode(shared.document, id) as ContainerNode & { autoLayout: AutoLayout }).autoLayout.primaryAxisSizingMode).toBe('FIXED');
    const row = grid(400, 200, 1, { gridColumns: [FIXED(200)] });
    const [rowChild] = childrenOf(row.file, row.id);
    const rowLayout = { ...row.file, document: updateNode(row.file.document, row.id, (node) => ({ ...node, autoLayout: { ...(node as ContainerNode & { autoLayout: AutoLayout }).autoLayout, layoutMode: 'HORIZONTAL' } }) as SceneNode) };
    expect((findNode(setGridShare(rowLayout, [rowChild!.id], 'width', 50).document, rowChild!.id) as SceneNode).gridWidthPercent).toBeUndefined();
  });

  it('keeps the cell share through a save and a load', () => {
    const { file, id } = grid(400, 200, 1, { gridColumns: [FIXED(200)], gridRows: [FIXED(100)] });
    const [only] = childrenOf(file, id);
    const restored = parseFile(serializeFile(setGridShare(file, [only!.id], 'height', 25)));
    expect(restored.ok).toBe(true);
    expect((findNode(restored.file!.document, only!.id) as SceneNode).gridHeightPercent).toBe(25);
  });
});
