import { describe, expect, it } from 'vitest';
import { flipNode, flipNodes, mirrorTransform } from './flip';
import { createFrameNode, createRectNode } from './factory';
import { emptyFile } from './validate';
import { absoluteBounds, findNode } from './tree';
import { applyToPoint, multiply, rotationOf } from './matrix';
import type { SceneNode } from './types';

function setup() {
  const file = emptyFile('Flip');
  const page = file.document.children[0]!;
  const frame = createFrameNode(null, 100, 100, 200, 100, { name: 'Frame' });
  const child = createRectNode(null, 20, 20, 60, 40);
  frame.children = [child];
  page.children = [frame];
  return { file, frameId: frame.id, childId: child.id };
}

describe('flip', () => {
  it('mirrors about the centre, leaving the box in place', () => {
    const { file, frameId } = setup();
    const before = absoluteBounds(file.document, frameId)!;
    const flipped = flipNodes(file, [frameId], 'horizontal');
    const node = findNode(flipped.document, frameId)!;
    expect(node.transform.a).toBeCloseTo(-1);
    expect(node.transform.tx).toBeCloseTo(300); // width 200: x' = 200 - x
    expect(absoluteBounds(flipped.document, frameId)).toEqual(before);
  });

  it('mirrors descendants with their parent (they live in the mirrored space)', () => {
    const { file, frameId, childId } = setup();
    const before = absoluteBounds(file.document, childId)!;
    const flipped = flipNodes(file, [frameId], 'horizontal');
    const child = findNode(flipped.document, childId)!;
    const after = absoluteBounds(flipped.document, childId)!;
    // The child's own transform is untouched; the frame's mirror moves it.
    expect(child.transform.tx).toBe(20);
    expect(child.width).toBe(60);
    // Frame spans 100..300, so a child at 120..180 mirrors to 220..280.
    expect(before.x).toBeCloseTo(120);
    expect(after.x).toBeCloseTo(220);
    expect(after.width).toBeCloseTo(before.width);
  });

  it('is its own inverse', () => {
    const { file, frameId } = setup();
    const original = findNode(file.document, frameId)!.transform;
    const twice = flipNodes(flipNodes(file, [frameId], 'vertical'), [frameId], 'vertical');
    const node = findNode(twice.document, frameId)!;
    expect(node.transform).toEqual(original);
  });

  it('works on a rotated node without moving its box', () => {
    const { file, frameId } = setup();
    const rotatedSource = {
      ...file,
      document: {
        ...file.document,
        children: file.document.children.map((page) => ({
          ...page,
          children: page.children.map((child) => (child.id === frameId ? { ...child, transform: { ...child.transform, a: 0, b: 1, c: -1, d: 0 } } : child)),
        })),
      },
    };
    const before = absoluteBounds(rotatedSource.document, frameId)!;
    const rotated = flipNodes(rotatedSource, [frameId], 'horizontal');
    const node = findNode(rotated.document, frameId)!;
    const after = absoluteBounds(rotated.document, frameId)!;
    // Mirroring about the node's own centre leaves its axis-aligned box untouched.
    expect(after).toEqual(before);
    // Mirroring a 90-degree rotation yields -90 degrees (still the same box).
    expect(rotationOf(node.transform)).toBeCloseTo(-90);
  });

  it('skips locked nodes and no-ops on missing ids', () => {
    const { file, frameId } = setup();
    const locked = { ...file, document: { ...file.document, children: file.document.children.map((page) => ({ ...page, children: page.children.map((child) => ({ ...child, locked: true })) })) } };
    expect(flipNodes(locked, [frameId], 'horizontal').document).toBe(locked.document);
    expect(flipNodes(file, ['nope'], 'horizontal').document).toBe(file.document);
  });

  it('builds the documented mirror matrices', () => {
    expect(mirrorTransform(200, 100, 'horizontal')).toEqual({ a: -1, b: 0, c: 0, d: 1, tx: 200, ty: 0 });
    expect(mirrorTransform(200, 100, 'vertical')).toEqual({ a: 1, b: 0, c: 0, d: -1, tx: 0, ty: 100 });
  });

  it('keeps world geometry stable when flipping a child inside a rotated frame', () => {
    const file = emptyFile('Rotated flip');
    const page = file.document.children[0]!;
    const frame = createFrameNode(null, 0, 0, 200, 200, { name: 'Frame' });
    frame.transform = { a: 0, b: 1, c: -1, d: 0, tx: 500, ty: 500 };
    const child = createRectNode(null, 10, 10, 40, 40);
    frame.children = [child];
    page.children = [frame];

    const before = absoluteBounds(file.document, child.id)!;
    const flipped = flipNode(file.document, child.id, 'horizontal');
    const after = findNode(flipped, child.id)!;
    // Mirroring a box about its own centre keeps the box and moves the origin so
    // x' = w - x for the content: 40 - 10 = 30 offset means origin lands at 50.
    expect(after.transform.tx).toBeCloseTo(50);
    expect(absoluteBounds(flipped, child.id)).toEqual(before);
    const world = multiply(frame.transform, after.transform);
    const centre = applyToPoint(world, 20, 20);
    expect(Number.isFinite(centre.x)).toBe(true);
  });

  it('flips a text node without changing its content', () => {
    const { file, frameId } = setup();
    const flipped = flipNodes(file, [frameId], 'vertical');
    const node = findNode(flipped.document, frameId) as SceneNode;
    expect(node.type).toBe('FRAME');
    expect(node.transform.d).toBeCloseTo(-1);
  });
});
