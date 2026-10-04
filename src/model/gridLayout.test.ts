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
import { reflowTree } from './autoLayout';
import { settleDocument } from './settle';
import { findNode } from './tree';
import type { AutoLayout, ContainerNode, GridTrackSize, PigmaFile, SceneNode } from './types';

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
});
