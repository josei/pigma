import { describe, expect, it } from 'vitest';
import { clampSize, clampWidth, enforceLimits, hasSizeLimits, limitsOf } from './sizing';
import { applyConstraints } from './constraints';
import { reflowTree } from './autoLayout';
import { emptyFile } from './validate';
import { createFrameNode, createRectNode } from './factory';
import { parseFile, serializeFile } from './serialize';
import { resizeFromHandle, setNodeSize } from './ops';
import type { PigmaFile, SceneNode } from './types';

function file(): { file: PigmaFile; rect: SceneNode } {
  const blank = emptyFile('Sizing');
  const page = blank.document.children[0]!;
  const rect = createRectNode(null, 0, 0, 100, 100);
  page.children = [rect];
  return { file: blank, rect };
}

describe('size limits', () => {
  it('resolves implicit minimums and unlimited maximums', () => {
    const { rect } = file();
    expect(limitsOf(rect)).toEqual({ minWidth: 1, minHeight: 1, maxWidth: Infinity, maxHeight: Infinity });
    rect.minWidth = 40;
    rect.maxWidth = 200;
    expect(limitsOf(rect)).toMatchObject({ minWidth: 40, maxWidth: 200 });
    // A maximum below the minimum is lifted to the minimum, never inverted.
    rect.minWidth = 300;
    expect(limitsOf(rect).maxWidth).toBe(300);
    expect(hasSizeLimits(rect)).toBe(true);
    expect(hasSizeLimits(file().rect)).toBe(false);
  });

  it('clamps width and height independently', () => {
    const { rect } = file();
    rect.minWidth = 50;
    rect.maxWidth = 150;
    rect.maxHeight = 80;
    expect(clampWidth(limitsOf(rect), 10)).toBe(50);
    expect(clampWidth(limitsOf(rect), 400)).toBe(150);
    expect(clampSize(rect, 400, 400)).toEqual({ width: 150, height: 80 });
    expect(clampSize(rect, 100, 40)).toEqual({ width: 100, height: 40 });
  });

  it('clamps resize handles and keeps the anchored edge fixed', () => {
    const { file: doc, rect } = file();
    rect.minWidth = 60;
    rect.maxWidth = 120;
    rect.minHeight = 40;
    // Drag the east handle far past the maximum.
    const grown = resizeFromHandle(doc, rect.id, 'e', 500, 0);
    const grownNode = grown.document.children[0]!.children[0] as SceneNode;
    expect(grownNode.width).toBe(120);
    expect(grownNode.transform.tx).toBe(0);
    // Drag the west handle past the maximum: the right edge stays anchored.
    const fromLeft = resizeFromHandle(doc, rect.id, 'w', -500, 0);
    const leftNode = fromLeft.document.children[0]!.children[0] as SceneNode;
    expect(leftNode.width).toBe(120);
    expect(leftNode.transform.tx).toBe(100 - 120);
    // Shrinking below the minimum stops at the minimum (the SE handle drives both axes).
    const shrunk = resizeFromHandle(doc, rect.id, 'se', -500, -500);
    const small = shrunk.document.children[0]!.children[0] as SceneNode;
    expect(small.width).toBe(60);
    expect(small.height).toBe(40);
  });

  it('clamps a typed size through setNodeSize', () => {
    const { file: doc, rect } = file();
    rect.maxWidth = 80;
    rect.minHeight = 30;
    const next = setNodeSize(doc, rect.id, 500, 5);
    const node = next.document.children[0]!.children[0] as SceneNode;
    expect(node.width).toBe(80);
    expect(node.height).toBe(30);
  });

  it('clamps a HUG auto-layout frame', () => {
    const blank = emptyFile('Layout');
    const page = blank.document.children[0]!;
    const frame = createFrameNode(null, 0, 0, 100, 100, { name: 'Row' });
    frame.maxWidth = 90;
    frame.minHeight = 120;
    frame.autoLayout = { layoutMode: 'HORIZONTAL', primaryAxisSizingMode: 'AUTO', counterAxisSizingMode: 'AUTO', paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0, itemSpacing: 0 };
    const a = createRectNode(null, 0, 0, 80, 40);
    const b = createRectNode(null, 80, 0, 80, 40);
    frame.children = [a, b];
    page.children = [frame];
    const reflowed = reflowTree(blank.document);
    const node = reflowed.children[0]!.children[0] as SceneNode;
    // Natural hug width would be 160; the maximum caps it, the minimum lifts the height.
    expect(node.width).toBe(90);
    expect(node.height).toBe(120);
  });

  it('clamps a stretched constraint', () => {
    const { rect } = file();
    rect.constraints = { horizontal: 'STRETCH', vertical: 'STRETCH' };
    rect.maxWidth = 150;
    const box = { x: 0, y: 0, width: 100, height: 100 };
    const resolved = applyConstraints(box, rect.constraints, { width: 100, height: 100 }, { width: 400, height: 400 }, limitsOf(rect));
    expect(resolved.width).toBe(150);
    expect(resolved.height).toBe(400);
  });

  it('enforces limits on an existing node and round-trips through JSON', () => {
    const { file: doc, rect } = file();
    rect.minWidth = 200;
    const enforced = enforceLimits(doc, rect.id);
    const node = enforced.document.children[0]!.children[0] as SceneNode;
    expect(node.width).toBe(200);
    // A node without limits is returned untouched (same reference).
    const plain = enforceLimits(doc, 'missing');
    expect(plain).toBe(doc);

    const restored = parseFile(serializeFile(enforced));
    expect(restored.ok).toBe(true);
    const roundTripped = restored.file!.document.children[0]!.children[0] as SceneNode;
    expect(roundTripped.minWidth).toBe(200);
    expect(roundTripped.maxWidth).toBeUndefined();
  });
});
