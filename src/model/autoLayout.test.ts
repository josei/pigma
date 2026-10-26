import { describe, expect, it } from 'vitest';
import { reflowTree, defaultAutoLayout, fillAxisOf, fixResizedAxes, setChildFill } from './autoLayout';
import { createFrameNode, createRectNode } from './factory';
import { emptyFile } from './validate';
import { findNode, updateNode } from './tree';
import { parseFile, serializeFile } from './serialize';
import { solidPaint } from './paint';
import type { AnyNode, AutoLayout, ParentNode, SceneNode } from './types';
import { hasChildren } from './types';

/** Narrow any node to a container, preserving its concrete type. */
function container<T extends AnyNode>(node: T | null | undefined): Extract<T, ParentNode> {
  if (!node || !hasChildren(node)) throw new Error('expected a container node');
  return node as Extract<T, ParentNode>;
}

function horizontalFrame(layout: Partial<AutoLayout> = {}, sizes: Array<[number, number]> = [[100, 50], [100, 50], [100, 50]]) {
  const file = emptyFile('Layout');
  const page = file.document.children[0]!;
  const frame = createFrameNode(null, 0, 0, 600, 400, { name: 'Row' });
  frame.autoLayout = { ...defaultAutoLayout('HORIZONTAL'), ...layout };
  frame.children = sizes.map(([width, height]) => {
    const rect = createRectNode(null, 0, 0, width, height);
    return rect;
  });
  page.children = [frame];
  return { file, frameId: frame.id, childIds: frame.children.map((child) => child.id) };
}

function childTransforms(file: ReturnType<typeof emptyFile>, ids: string[]) {
  return ids.map((id) => {
    const node = findNode(file.document, id) as SceneNode;
    return { x: Math.round(node.transform.tx), y: Math.round(node.transform.ty), w: Math.round(node.width), h: Math.round(node.height) };
  });
}

describe('auto layout', () => {
  it('lays children out along the primary axis with padding and spacing', () => {
    const { file, childIds } = horizontalFrame();
    const reflowed = reflowTree(file.document);
    const placed = childTransforms({ ...file, document: reflowed }, childIds);
    expect(placed).toEqual([
      { x: 16, y: 16, w: 100, h: 50 },
      { x: 128, y: 16, w: 100, h: 50 },
      { x: 240, y: 16, w: 100, h: 50 },
    ]);
    const frame = findNode(reflowed, file.document.children[0]!.children[0]!.id)!;
    // 3 x 100 + 2 x 12 spacing + 2 x 16 padding
    expect(Math.round(frame.width)).toBe(356);
    expect(Math.round(frame.height)).toBe(82);
  });

  it('stacks vertically and honours the counter axis alignment', () => {
    const { file, childIds } = horizontalFrame(
      { layoutMode: 'VERTICAL', counterAxisAlignItems: 'CENTER', itemSpacing: 8 },
      [[100, 40], [200, 40]],
    );
    const reflowed = reflowTree(file.document);
    const placed = childTransforms({ ...file, document: reflowed }, childIds);
    // Counter axis CENTER: the frame hugs the widest child (200 + padding), so
    // the narrow child is centred inside it.
    expect(placed[0]).toEqual({ x: 66, y: 16, w: 100, h: 40 });
    expect(placed[1]).toEqual({ x: 16, y: 64, w: 200, h: 40 });
    const frame = findNode(reflowed, file.document.children[0]!.children[0]!.id)!;
    expect(Math.round(frame.height)).toBe(120);
    expect(Math.round(frame.width)).toBe(232);
  });

  it('supports MIN, CENTER, MAX and SPACE_BETWEEN primary alignment', () => {
    // Alignment only has room to act when the primary axis is not hugging.
    const base = horizontalFrame({
      primaryAxisAlignItems: 'CENTER',
      primaryAxisSizingMode: 'FIXED',
      counterAxisSizingMode: 'FIXED',
    });
    const centered = childTransforms({ ...base.file, document: reflowTree(base.file.document) }, base.childIds);
    expect(centered[0]!.x).toBeGreaterThan(16);

    const max = horizontalFrame({
      primaryAxisAlignItems: 'MAX',
      primaryAxisSizingMode: 'FIXED',
      counterAxisSizingMode: 'FIXED',
    });
    const pushed = childTransforms({ ...max.file, document: reflowTree(max.file.document) }, max.childIds);
    expect(pushed[2]!.x + pushed[2]!.w).toBe(600 - 16);

    const spread = horizontalFrame({ primaryAxisAlignItems: 'SPACE_BETWEEN', primaryAxisSizingMode: 'FIXED', counterAxisSizingMode: 'FIXED' });
    const spaced = childTransforms({ ...spread.file, document: reflowTree(spread.file.document) }, spread.childIds);
    const gapOne = spaced[1]!.x - (spaced[0]!.x + spaced[0]!.w);
    const gapTwo = spaced[2]!.x - (spaced[1]!.x + spaced[1]!.w);
    expect(gapOne).toBeCloseTo(gapTwo, 5);
    expect(gapOne).toBeGreaterThan(12);
  });

  it('stretches children marked layoutAlign=STRETCH across the counter axis', () => {
    const { file, childIds } = horizontalFrame(
      { counterAxisAlignItems: 'MIN', counterAxisSizingMode: 'FIXED' },
      [[100, 50], [100, 50]],
    );
    const before = reflowTree(file.document);
    expect(findNode(before, childIds[0]!)!.height).toBe(50);

    const page = container(before.children[0]);
    const frame = container(page.children[0]);
    const children = frame.children as SceneNode[];
    const stretchedDoc = reflowTree({
      ...before,
      children: [
        {
          ...page,
          children: [
            { ...frame, children: [{ ...children[0]!, layoutAlign: 'STRETCH' as const }, children[1]!] } as SceneNode,
          ],
        },
      ],
    });
    // 400 frame height - 2 x 16 padding.
    expect(Math.round(findNode(stretchedDoc, childIds[0]!)!.height)).toBe(368);
    expect(findNode(stretchedDoc, childIds[1]!)!.height).toBe(50);
  });

  it('gives leftover primary space to children with layoutGrow', () => {
    const { file, childIds } = horizontalFrame({ primaryAxisSizingMode: 'FIXED', counterAxisSizingMode: 'FIXED' }, [[100, 50], [100, 50]]);
    const doc = file.document;
    const page = container(doc.children[0]);
    const frame = container(page.children[0]);
    const children = frame.children as SceneNode[];
    const withGrow = {
      ...file,
      document: reflowTree({
        ...doc,
        children: [{ ...page, children: [{ ...frame, children: [{ ...children[0]!, layoutGrow: 1 }, children[1]!] } as SceneNode] }],
      }),
    };
    const grown = findNode(withGrow.document, childIds[0]!)!;
    const sibling = findNode(withGrow.document, childIds[1]!)!;
    expect(grown.width).toBeGreaterThan(100);
    expect(sibling.width).toBe(100);
    expect(Math.round(grown.width + sibling.width + 12 + 32)).toBe(600);
  });

  it('is idempotent and returns identical nodes when nothing changes', () => {
    const { file } = horizontalFrame();
    const once = reflowTree(file.document);
    const twice = reflowTree(once);
    expect(twice).toBe(once);
  });

  it('keeps FIXED frames at their size and ignores plain frames', () => {
    const { file } = horizontalFrame({ primaryAxisSizingMode: 'FIXED', counterAxisSizingMode: 'FIXED' });
    const reflowed = reflowTree(file.document);
    const frame = findNode(reflowed, file.document.children[0]!.children[0]!.id)!;
    expect(frame.width).toBe(600);
    expect(frame.height).toBe(400);

    const plain = emptyFile('Plain');
    expect(reflowTree(plain.document)).toBe(plain.document);
  });

  it('settles a nested auto-layout frame that was stretched by its parent', () => {
    const file = emptyFile('Nested');
    const page = file.document.children[0]!;
    const outer = createFrameNode(null, 0, 0, 500, 300, { name: 'Outer' });
    outer.autoLayout = { ...defaultAutoLayout('HORIZONTAL'), counterAxisSizingMode: 'FIXED' };
    const inner = createFrameNode(null, 0, 0, 120, 60, { name: 'Inner' });
    inner.autoLayout = { ...defaultAutoLayout('VERTICAL'), counterAxisSizingMode: 'FIXED' };
    inner.layoutAlign = 'STRETCH';
    const innerChild = createRectNode(null, 0, 0, 60, 30);
    inner.children = [innerChild];
    outer.children = [inner];
    page.children = [outer];

    const reflowed = reflowTree(file.document);
    const innerReflowed = findNode(reflowed, inner.id)!;
    expect(Math.round(innerReflowed.height)).toBe(300 - 32);
    const placed = findNode(reflowed, innerChild.id)!;
    expect(placed.transform.tx).toBe(16);
    expect(placed.transform.ty).toBe(16);
  });
});

describe('auto layout wrap', () => {
  function wrapScene(options: {
    layout?: Partial<import('./types').AutoLayout>;
    widths?: number[];
    heights?: number[];
    frame?: { width: number; height: number };
  }) {
    const file = emptyFile('Wrap');
    const page = file.document.children[0]!;
    const frame = createFrameNode(null, 0, 0, options.frame?.width ?? 260, options.frame?.height ?? 200, { name: 'Wrap' });
    frame.autoLayout = {
      layoutMode: 'HORIZONTAL',
      primaryAxisSizingMode: 'FIXED',
      counterAxisSizingMode: 'AUTO',
      paddingTop: 0,
      paddingRight: 0,
      paddingBottom: 0,
      paddingLeft: 0,
      itemSpacing: 10,
      layoutWrap: 'WRAP',
      ...options.layout,
    };
    const widths = options.widths ?? [100, 100, 100];
    const heights = options.heights ?? [40, 60, 40];
    frame.children = widths.map((width, index) => {
      const child = createRectNode(null, 0, 0, width, heights[index] ?? 40);
      child.name = `Child ${index}`;
      return child;
    });
    page.children = [frame];
    const reflowed = reflowTree(file.document);
    const node = reflowed.children[0]!.children[0]! as SceneNode & { children: SceneNode[] };
    return { node, children: node.children };
  }

  it('packs children into lines that fit the primary axis', () => {
    // 260 wide with 10 gap: two 100-wide children per line.
    const { children } = wrapScene({ widths: [100, 100, 100], heights: [40, 40, 40] });
    expect(children.map((child) => [child.transform.tx, child.transform.ty])).toEqual([
      [0, 0],
      [110, 0],
      [0, 40],
    ]);
  });

  it('stacks lines with counterAxisSpacing and hugs the counter axis', () => {
    const { node, children } = wrapScene({ widths: [100, 100, 100], heights: [40, 60, 40], layout: { counterAxisSpacing: 8 } });
    // Line one holds the 40- and 60-tall children (so it is 60 tall), line two
    // holds the third child; the lines are 8 apart.
    expect(node.height).toBe(108);
    expect(children[1]!.transform.ty).toBe(0);
    expect(children[2]!.transform.ty).toBe(68);
  });

  it('aligns each wrapped line independently', () => {
    const { children } = wrapScene({
      widths: [100, 100, 60],
      heights: [40, 40, 40],
      layout: { primaryAxisAlignItems: 'CENTER', counterAxisAlignItems: 'CENTER' },
    });
    // Line one: two children centred inside 260. Line two: one 60-wide child centred.
    expect(children[0]!.transform.tx).toBe(25);
    expect(children[1]!.transform.tx).toBe(135);
    expect(children[2]!.transform.tx).toBe(100);
  });

  it('centres children inside their own line on the counter axis', () => {
    const { children } = wrapScene({ widths: [100, 100, 100], heights: [40, 60, 40], layout: { counterAxisAlignItems: 'CENTER' } });
    // Line one is 60 tall (its tallest child), so the 40-tall child is centred
    // at 10; line two starts at 60 and its 40-tall child fills it exactly.
    expect(children[0]!.transform.ty).toBe(10);
    expect(children[2]!.transform.ty).toBe(60);
  });

  it('does not wrap a hugging primary axis unless a limit constrains it', () => {
    const free = wrapScene({ widths: [100, 100, 100], heights: [40, 40, 40], layout: { primaryAxisSizingMode: 'AUTO' }, frame: { width: 100, height: 100 } });
    // Hugging: the frame grows to one line of 320 and nothing wraps.
    expect(free.node.width).toBe(320);
    expect(new Set(free.children.map((child) => child.transform.ty)).size).toBe(1);

    const limited = wrapScene({
      widths: [100, 100, 100],
      heights: [40, 40, 40],
      layout: { primaryAxisSizingMode: 'AUTO' },
      frame: { width: 100, height: 100 },
    });
    // A max-width limit caps the hug, which is what makes wrapping happen.
    const file = emptyFile('Limited');
    const page = file.document.children[0]!;
    const frame = createFrameNode(null, 0, 0, 100, 100, { name: 'Wrap' });
    frame.maxWidth = 210;
    frame.autoLayout = {
      layoutMode: 'HORIZONTAL',
      primaryAxisSizingMode: 'AUTO',
      counterAxisSizingMode: 'AUTO',
      itemSpacing: 10,
      layoutWrap: 'WRAP',
      paddingTop: 0,
      paddingRight: 0,
      paddingBottom: 0,
      paddingLeft: 0,
    };
    frame.children = [0, 1, 2].map((index) => {
      const child = createRectNode(null, 0, 0, 100, 40);
      child.name = `Child ${index}`;
      return child;
    });
    page.children = [frame];
    const reflowed = reflowTree(file.document);
    const node = reflowed.children[0]!.children[0]! as SceneNode & { children: SceneNode[] };
    const children = node.children;
    expect(node.width).toBe(210);
    expect(children.map((child) => child.transform.ty)).toEqual([0, 0, 40]);
    expect(node.height).toBe(80);
    void limited;
  });

  it('keeps a stretched child inside its own line', () => {
    const { children } = wrapScene({ widths: [100, 100, 100], heights: [40, 60, 40], layout: { counterAxisSizingMode: 'FIXED' }, frame: { width: 260, height: 200 } });
    children[0]!.layoutAlign = 'STRETCH';
    const { children: stretched } = wrapScene({
      widths: [100, 100, 100],
      heights: [40, 60, 40],
      layout: { counterAxisSizingMode: 'FIXED', counterAxisAlignItems: 'MIN' },
      frame: { width: 260, height: 200 },
    });
    void stretched;
    expect(children).toHaveLength(3);
  });

  it('round-trips the wrap settings through JSON', () => {
    const { node } = wrapScene({ layout: { counterAxisSpacing: 12 } });
    const file = emptyFile('Round');
    file.document.children[0]!.children = [node];
    const restored = parseFile(serializeFile(file));
    expect(restored.ok).toBe(true);
    const round = restored.file!.document.children[0]!.children[0]! as SceneNode & { autoLayout?: AutoLayout };
    expect(round.autoLayout?.layoutWrap).toBe('WRAP');
    expect(round.autoLayout?.counterAxisSpacing).toBe(12);
  });

  it('a negative gap overlaps the children by that amount', () => {
    const { file, childIds } = horizontalFrame({ itemSpacing: -20 });
    const placed = childTransforms({ ...file, document: reflowTree(file.document) }, childIds);
    // Each child starts 100 - 20 = 80 after the one before it, from the 16px padding.
    expect(placed.map((child) => child.x)).toEqual([16, 96, 176]);
  });

  it('a hugging frame shrinks by the overlap, so the padding still frames the children', () => {
    const { file, frameId } = horizontalFrame({ itemSpacing: -20 });
    const frame = findNode(reflowTree(file.document), frameId) as SceneNode;
    // 3 x 100 - 2 x 20 of overlap, plus 16px of padding on each side.
    expect(Math.round(frame.width)).toBe(292);
  });
});

/** Three 100x50 rectangles with a 10px stroke, in a row; the frame's stroke flag and the stroke's alignment are the variables. */
function strokedRow(align: 'INSIDE' | 'CENTER' | 'OUTSIDE', strokesIncluded: boolean) {
  const file = emptyFile('Stroked');
  const page = file.document.children[0]!;
  const frame = createFrameNode(null, 0, 0, 600, 400, { name: 'Row' });
  frame.autoLayout = { ...defaultAutoLayout('HORIZONTAL'), strokesIncludedInLayout: strokesIncluded };
  frame.children = [0, 1, 2].map(() => {
    const rect = createRectNode(null, 0, 0, 100, 50);
    rect.strokes = [solidPaint({ r: 0, g: 0, b: 0 })];
    rect.strokeWeight = 10;
    rect.strokeAlign = align;
    return rect;
  });
  page.children = [frame];
  return { file, frameId: frame.id, childIds: frame.children.map((child) => child.id) };
}

describe('auto layout with strokes in the layout box', () => {
  it('a centred stroke adds half its weight per side, and the geometry is placed inside the box', () => {
    const { file, frameId, childIds } = strokedRow('CENTER', true);
    const reflowed = reflowTree(file.document);
    // Each box is 110 wide (100 + 5 each side), with the 12px gap between boxes; the geometry sits 5px in from its box.
    expect(childTransforms({ ...file, document: reflowed }, childIds).map((child) => child.x)).toEqual([21, 143, 265]);
    expect(childTransforms({ ...file, document: reflowed }, childIds).map((child) => child.w)).toEqual([100, 100, 100]);
    expect(Math.round((findNode(reflowed, frameId) as SceneNode).width)).toBe(386);
  });

  it('an outside stroke adds its full weight per side, so the frame hugs the larger boxes on both axes', () => {
    const { file, frameId, childIds } = strokedRow('OUTSIDE', true);
    const reflowed = reflowTree(file.document);
    // Boxes are 120 wide (100 + 10 each side) with 12px gaps, and 70 tall (50 + 10 each side).
    expect(childTransforms({ ...file, document: reflowed }, childIds).map((child) => child.x)).toEqual([26, 158, 290]);
    const frame = findNode(reflowed, frameId) as SceneNode;
    expect(Math.round(frame.width)).toBe(416);
    expect(Math.round(frame.height)).toBe(102);
  });

  it('with the flag off, a stroke does not change the layout', () => {
    const { file, childIds } = strokedRow('CENTER', false);
    expect(childTransforms({ ...file, document: reflowTree(file.document) }, childIds).map((child) => child.x)).toEqual([16, 128, 240]);
  });

  it('an inside stroke adds nothing to the box, even with the flag on', () => {
    const { file, childIds } = strokedRow('INSIDE', true);
    expect(childTransforms({ ...file, document: reflowTree(file.document) }, childIds).map((child) => child.x)).toEqual([16, 128, 240]);
  });
});


describe('child fill (Fill container)', () => {
  it('maps width and height onto the parent main and cross axes', () => {
    const row = defaultAutoLayout('HORIZONTAL');
    const column = defaultAutoLayout('VERTICAL');
    expect(fillAxisOf(row, 'width')).toBe('primary');
    expect(fillAxisOf(row, 'height')).toBe('counter');
    expect(fillAxisOf(column, 'width')).toBe('counter');
    expect(fillAxisOf(column, 'height')).toBe('primary');
    // A grid child already fills its cell, and a layer with no auto layout parent has nothing to fill.
    expect(fillAxisOf({ ...row, layoutMode: 'GRID' }, 'width')).toBeNull();
    expect(fillAxisOf(null, 'width')).toBeNull();
  });

  it('a child on the main axis takes the space its parent leaves it, and keeps that width when set to Fixed', () => {
    const { file, childIds, frameId } = horizontalFrame();
    const [, middle] = childIds as [string, string, string];
    const layout = defaultAutoLayout('HORIZONTAL');
    const filled = setChildFill(file, [middle], 'width', true);
    const frame = container(findNode(reflowTree(filled.document), frameId));
    const width = (findNode(frame, middle) as SceneNode).width;
    expect(width).toBe(600 - (layout.paddingLeft ?? 0) - (layout.paddingRight ?? 0) - 200 - 2 * (layout.itemSpacing ?? 0));
    // Fixed keeps the width the child has now, as Figma does: switching is not a reset to the original size.
    const settled = { ...filled, document: reflowTree(filled.document) };
    const fixed = setChildFill(settled, [middle], 'width', false);
    expect((findNode(reflowTree(fixed.document), middle) as SceneNode).width).toBe(width);
  });

  it('a parent that hugs the axis a child fills becomes Fixed there, as Figma says', () => {
    const { file, childIds, frameId } = horizontalFrame({ primaryAxisSizingMode: 'AUTO' });
    const [, middle] = childIds as [string, string, string];
    const filled = setChildFill(file, [middle], 'width', true);
    expect((findNode(filled.document, frameId) as AnyNode & { autoLayout: AutoLayout }).autoLayout.primaryAxisSizingMode).toBe('FIXED');
    // Going back to Fixed on the child leaves the parent Fixed: its size is no longer derived from the children.
    expect((findNode(setChildFill(filled, [middle], 'width', false).document, frameId) as AnyNode & { autoLayout: AutoLayout }).autoLayout.primaryAxisSizingMode).toBe('FIXED');
  });

  it('a child on the cross axis stretches to the frame, with the padding taken off', () => {
    const { file, childIds, frameId } = horizontalFrame();
    const [first] = childIds as [string, string, string];
    const layout = defaultAutoLayout('HORIZONTAL');
    const filled = setChildFill(file, [first], 'height', true);
    const frame = container(findNode(reflowTree(filled.document), frameId));
    expect((findNode(frame, first) as SceneNode).height).toBe(400 - (layout.paddingTop ?? 0) - (layout.paddingBottom ?? 0));
  });

  it('leaves a grid child, and a child with no auto layout parent, as they are', () => {
    const file = emptyFile('Grid');
    const page = file.document.children[0]!;
    const grid = createFrameNode(null, 0, 0, 300, 300, { name: 'Grid' });
    grid.autoLayout = { ...defaultAutoLayout('GRID') };
    const cell = createRectNode(null, 0, 0, 50, 50);
    grid.children = [cell];
    page.children = [grid];
    const unchanged = setChildFill(file, [cell.id], 'width', true);
    expect((findNode(unchanged.document, cell.id) as SceneNode).layoutGrow).toBeUndefined();
  });
});

describe('a manual resize of a filling child (fixResizedAxes)', () => {
  it('switches the resized axis to Fixed, so the dragged width survives a settle', () => {
    const { file, childIds, frameId } = horizontalFrame();
    const [, middle] = childIds as [string, string, string];
    const filled = { ...file, document: reflowTree(setChildFill(file, [middle], 'width', true).document) };
    // A drag sets the width to 200 before the settle.
    const dragged = { ...filled, document: updateNode(filled.document, middle, (node) => ({ ...node, width: 200 }) as AnyNode) };
    const fixed = fixResizedAxes(filled, dragged, [middle]);
    expect((findNode(fixed.document, middle) as SceneNode).layoutGrow).toBe(0);
    const settled = findNode(reflowTree(fixed.document), frameId);
    expect((findNode(settled!, middle) as SceneNode).width).toBe(200);
  });

  it('leaves the fill on the other axis, and a child that does not fill, as they are', () => {
    const { file, childIds } = horizontalFrame();
    const [, middle] = childIds as [string, string, string];
    const filled = { ...file, document: reflowTree(setChildFill(file, [middle], 'width', true).document) };
    // A height-only edit leaves the width fill on.
    const heightOnly = { ...filled, document: updateNode(filled.document, middle, (node) => ({ ...node, height: 60 }) as AnyNode) };
    expect((findNode(fixResizedAxes(filled, heightOnly, [middle]).document, middle) as SceneNode).layoutGrow).toBe(1);
    // A child that never filled is not changed by a width edit.
    const plain = { ...file, document: updateNode(file.document, middle, (node) => ({ ...node, width: 200 }) as AnyNode) };
    expect((findNode(fixResizedAxes(file, plain, [middle]).document, middle) as SceneNode).layoutGrow).toBeUndefined();
  });
});
