import { describe, expect, it } from 'vitest';
import {
  anchorsFromPathData,
  insertAnchor,
  moveAnchor,
  normalizePath,
  pathDataFromAnchors,
  pointOnSegment,
  removeAnchor,
  setTangent,
  vectorBounds,
  vectorNodeFromPath,
  vectorPathOf,
  writeVectorPath,
  worldAnchors,
} from './vector';
import { emptyFile } from './validate';
import { createRectNode } from './factory';
import { findNode } from './tree';
import { parseFile, serializeFile } from './serialize';

const triangle = {
  closed: true,
  anchors: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 50, y: 80 },
  ],
};

describe('vector paths', () => {
  it('writes and reads straight segments', () => {
    const data = pathDataFromAnchors(triangle);
    expect(data).toBe('M 0 0 L 100 0 L 50 80 Z');
    const parsed = anchorsFromPathData(data)!;
    expect(parsed.closed).toBe(true);
    expect(parsed.anchors.map((a) => [a.x, a.y])).toEqual([[0, 0], [100, 0], [50, 80]]);
  });

  it('round-trips cubic tangents', () => {
    const path = {
      closed: false,
      anchors: [
        { x: 0, y: 0, out: { x: 40, y: 0 } },
        { x: 120, y: 60, in: { x: -40, y: 0 } },
      ],
    };
    const data = pathDataFromAnchors(path);
    expect(data).toContain('C 40 0 80 60 120 60');
    const parsed = anchorsFromPathData(data)!;
    expect(parsed.anchors[0]!.out).toEqual({ x: 40, y: 0 });
    expect(parsed.anchors[1]!.in).toEqual({ x: -40, y: 0 });
  });

  it('refuses paths it cannot anchor-edit instead of guessing', () => {
    expect(anchorsFromPathData('')).toBeNull();
    expect(anchorsFromPathData('M 0 0 q 10 10 20 0')).toBeNull();
    expect(anchorsFromPathData('M 0 0 a 5 5 0 0 1 10 10')).toBeNull();
    expect(anchorsFromPathData('nonsense')).toBeNull();
  });

  it('measures bounds including handles', () => {
    expect(vectorBounds(triangle.anchors)).toEqual({ x: 0, y: 0, width: 100, height: 80 });
    const curved = [{ x: 50, y: 50, out: { x: 20, y: -30 } }];
    expect(vectorBounds(curved)).toEqual({ x: 50, y: 20, width: 20, height: 30 });
  });

  it('normalises to a local origin', () => {
    const shifted = normalizePath({ closed: false, anchors: [{ x: 30, y: 40 }, { x: 130, y: 140 }] });
    expect(shifted.offset).toEqual({ x: 30, y: 40 });
    expect(shifted.path.anchors[0]).toMatchObject({ x: 0, y: 0 });
  });

  it('inserts and removes anchors', () => {
    const withMid = insertAnchor(triangle, 0);
    expect(withMid.anchors).toHaveLength(4);
    expect(withMid.anchors[1]).toMatchObject({ x: 50, y: 0 });

    const removed = removeAnchor(withMid, 1);
    expect(removed.anchors).toHaveLength(3);
    // Never drop below a usable path.
    expect(removeAnchor({ closed: false, anchors: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }, 0).anchors).toHaveLength(2);
  });

  it('moves anchors and mirrors tangents', () => {
    const moved = moveAnchor(triangle, 1, 200, 10);
    expect(moved.anchors[1]).toMatchObject({ x: 200, y: 10 });

    const withTangent = setTangent({ closed: false, anchors: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }, 0, 'out', { x: 20, y: 5 });
    expect(withTangent.anchors[0]!.out).toEqual({ x: 20, y: 5 });
    expect(withTangent.anchors[0]!.in).toEqual({ x: -20, y: -5 });
  });

  it('samples line and curve segments', () => {
    const line = pointOnSegment({ x: 0, y: 0 }, { x: 10, y: 20 }, 0.5);
    expect(line).toEqual({ x: 5, y: 10 });
    const curve = pointOnSegment({ x: 0, y: 0, out: { x: 0, y: 0 } }, { x: 100, y: 0, in: { x: 0, y: 0 } }, 0.5);
    expect(curve.x).toBeCloseTo(50);
    expect(curve.y).toBeCloseTo(0);
  });

  it('creates a vector node with a local box and no offset drift', () => {
    const node = vectorNodeFromPath(null, triangle, { x: 10, y: 20 });
    expect(node.type).toBe('VECTOR');
    expect(node.width).toBe(100);
    expect(node.height).toBe(80);
    expect(node.transform.tx).toBe(10);
    expect(node.transform.ty).toBe(20);
    expect(node.pathData).toBe('M 0 0 L 100 0 L 50 80 Z');
  });

  it('writes edits back without moving the shape', () => {
    const file = emptyFile('Vector');
    const page = file.document.children[0]!;
    const node = vectorNodeFromPath(null, triangle, { x: 100, y: 100 });
    page.children = [node];

    // Drag the leftmost anchor 40 units to the left: the box grows, the origin shifts.
    const edited = writeVectorPath(file, node.id, moveAnchor(triangle, 0, -40, 0));
    const after = findNode(edited.document, node.id)!;
    expect(after.width).toBe(140);
    expect(after.transform.tx).toBe(60);
    expect(after.pathData).toContain('M 0 0');
    // The untouched anchors stay exactly where they were in world space.
    const anchors = worldAnchors(edited.document, node.id);
    expect(Math.max(...anchors.map((a) => a.x))).toBeCloseTo(200);
    expect(Math.min(...anchors.map((a) => a.x))).toBeCloseTo(60);
  });

  it('round-trips vector geometry through JSON persistence', () => {
    const file = emptyFile('Vector');
    const page = file.document.children[0]!;
    const node = vectorNodeFromPath(null, triangle, { x: 0, y: 0 });
    page.children = [node];
    const restored = parseFile(serializeFile(file));
    const roundTripped = findNode(restored.file!.document, node.id)!;
    expect(roundTripped.pathData).toBe('M 0 0 L 100 0 L 50 80 Z');
    expect(vectorPathOf(roundTripped)?.anchors).toHaveLength(3);
  });

  it('reports no editable path for non-vector nodes', () => {
    const rect = createRectNode(null, 0, 0, 10, 10);
    expect(vectorPathOf(rect)).toBeNull();
    expect(worldAnchors(rect, rect.id)).toEqual([]);
  });

  it('keeps a curved closure instead of letting Z flatten it', () => {
    const curved = {
      closed: true,
      anchors: [
        { x: 0, y: 0, in: { x: -20, y: 0 } },
        { x: 100, y: 0 },
        { x: 50, y: 80, out: { x: 0, y: 20 } },
      ],
    };
    const data = pathDataFromAnchors(curved);
    expect(data).toContain('C 50 100 -20 0 0 0');
    expect(data.endsWith('Z')).toBe(true);
    expect(anchorsFromPathData(data)?.anchors[0]!.in).toEqual({ x: -20, y: 0 });
  });
});
