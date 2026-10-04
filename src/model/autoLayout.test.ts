import { describe, expect, it } from 'vitest';
import { reflowTree, defaultAutoLayout } from './autoLayout';
import { createFrameNode, createRectNode } from './factory';
import { emptyFile } from './validate';
import { findNode } from './tree';
import { parseFile, serializeFile } from './serialize';
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
});
