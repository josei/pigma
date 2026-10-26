import { describe, expect, it } from 'vitest';
import { NO_SNAP, computeSnap, snapEdge, snapValue } from './snapping';
import { createFrameNode, createRectNode } from './factory';
import { defaultAutoLayout } from './autoLayout';
import { emptyFile } from './validate';

const OPTIONS = { threshold: 4, snapToObjects: true, snapToGrid: false, gridSize: 8 };

function scene() {
  const file = emptyFile('Snap');
  const page = file.document.children[0]!;
  const anchor = createRectNode(null, 100, 100, 200, 100); // left 100, centre 200, right 300
  const mover = createRectNode(null, 400, 300, 100, 50);
  page.children = [anchor, mover];
  return { file, pageId: page.id, anchorId: anchor.id, moverId: mover.id };
}

describe('snapping', () => {
  it('snaps the moving box to a ruler guide, even with no sibling nearby', () => {
    const { file, moverId } = scene();
    // The guide sits 3px right of the proposed left edge. The box is 90 wide, so its centre (192) and right edge (237)
    // are out of reach of the anchor's edges and centre, and only the guide is in range.
    const result = computeSnap(file.document, [moverId], { x: 147, y: 300, width: 90, height: 50 }, { ...OPTIONS, guides: { x: [150], y: [] } });
    expect(result.dx).toBeCloseTo(3);
    expect(result.guides.some((entry) => entry.axis === 'x' && entry.position === 150)).toBe(true);
  });

  it('ignores a ruler guide when snapping to objects is off', () => {
    const { file, moverId } = scene();
    const result = computeSnap(file.document, [moverId], { x: 147, y: 300, width: 90, height: 50 }, { ...OPTIONS, snapToObjects: false, guides: { x: [150], y: [] } });
    expect(result).toEqual(NO_SNAP);
  });

  it('snaps the moving box to a sibling edge and reports a guide', () => {
    const { file, moverId } = scene();
    // Proposed left edge is 2px away from the anchor's left edge (100).
    const result = computeSnap(file.document, [moverId], { x: 102, y: 300, width: 100, height: 50 }, OPTIONS);
    expect(result.dx).toBeCloseTo(-2);
    expect(result.dy).toBe(0);
    const guide = result.guides.find((entry) => entry.axis === 'x');
    expect(guide?.position).toBe(100);
    expect(guide?.from).toBeLessThanOrEqual(100);
    expect(guide?.to).toBeGreaterThanOrEqual(150);
  });

  it('aligns centres on both axes', () => {
    const { file, moverId } = scene();
    // Moving centre at 202 vs anchor centre 200; vertical centre 152 vs 150.
    const result = computeSnap(file.document, [moverId], { x: 152, y: 127, width: 100, height: 50 }, OPTIONS);
    expect(result.dx).toBeCloseTo(-2);
    expect(result.dy).toBeCloseTo(-2);
    expect(result.guides.map((guide) => guide.axis).sort()).toEqual(['x', 'y']);
  });

  it('does not snap beyond the threshold', () => {
    const { file, moverId } = scene();
    const result = computeSnap(file.document, [moverId], { x: 140, y: 400, width: 100, height: 50 }, OPTIONS);
    expect(result).toEqual(NO_SNAP);
  });

  it('never snaps a node to itself', () => {
    const { file, moverId } = scene();
    const result = computeSnap(file.document, [moverId], { x: 401, y: 301, width: 100, height: 50 }, OPTIONS);
    expect(result).toEqual(NO_SNAP);
  });

  it('snaps to the pixel grid when enabled', () => {
    const { file, moverId } = scene();
    const result = computeSnap(file.document, [moverId], { x: 405, y: 301, width: 100, height: 50 }, {
      threshold: 6,
      snapToObjects: false,
      snapToGrid: true,
      gridSize: 8,
    });
    // 405 -> 408 and 301 -> 304 (nearest multiples of the 8px grid).
    expect(result.dx).toBeCloseTo(3);
    expect(result.dy).toBeCloseTo(3);
    expect(result.guides).toEqual([]);
  });

  it('can be disabled entirely', () => {
    const { file, moverId } = scene();
    const result = computeSnap(file.document, [moverId], { x: 101, y: 100, width: 100, height: 50 }, {
      threshold: 4,
      snapToObjects: false,
      snapToGrid: false,
      gridSize: 8,
    });
    expect(result).toEqual(NO_SNAP);
  });

  it('snaps a single edge for resize handles', () => {
    const { file, moverId } = scene();
    const snapped = snapValue(file.document, [moverId], 302, 'x', OPTIONS);
    expect(snapped).toBe(300);
    expect(snapValue(file.document, [moverId], 350, 'x', OPTIONS)).toBe(350);
  });

  it('returns nothing for an empty selection', () => {
    const { file } = scene();
    expect(computeSnap(file.document, [], { x: 0, y: 0, width: 10, height: 10 }, OPTIONS)).toEqual(NO_SNAP);
  });

  it('snaps a child to the edge of its parent frame', () => {
    const file = emptyFile('Frame snap');
    const page = file.document.children[0]!;
    const frame = createFrameNode(null, 0, 0, 600, 400, { name: 'Frame' });
    const child = createRectNode(null, 300, 150, 100, 50);
    frame.children = [child];
    page.children = [frame];
    // The proposed left edge is 2px right of the frame's left edge (0), and nothing else is in reach.
    const result = computeSnap(file.document, [child.id], { x: 2, y: 150, width: 100, height: 50 }, OPTIONS);
    expect(result.dx).toBeCloseTo(-2);
    expect(result.guides.some((entry) => entry.axis === 'x' && entry.position === 0)).toBe(true);
  });

  it('snapEdge reports the guide for the edge it snapped, across the moving node', () => {
    const { file, moverId } = scene();
    // The anchor's left edge is at 100; the moving edge is 2 short of it.
    const result = snapEdge(file.document, [moverId], 102, 'x', OPTIONS);
    expect(result.value).toBe(100);
    expect(result.guide).toMatchObject({ axis: 'x', position: 100 });
  });

  it('snapEdge returns the value unchanged, with no guide, when nothing is in reach', () => {
    const { file, moverId } = scene();
    expect(snapEdge(file.document, [moverId], 350, 'x', OPTIONS)).toEqual({ value: 350, guide: null });
  });

  it('snapEdge snaps a resized edge to its frame\'s auto layout padding line', () => {
    const file = emptyFile('Padding snap');
    const page = file.document.children[0]!;
    const frame = createFrameNode(null, 0, 0, 600, 400, { name: 'Frame' });
    frame.autoLayout = { ...defaultAutoLayout('HORIZONTAL'), paddingRight: 24 };
    const child = createRectNode(null, 300, 150, 100, 50);
    frame.children = [child];
    page.children = [frame];
    // The padding line on the right is at 600 - 24 = 576; the child's right edge is 3 units short of it.
    const result = snapEdge(file.document, [child.id], 573, 'x', OPTIONS);
    expect(result.value).toBe(576);
    expect(result.guide).toMatchObject({ axis: 'x', position: 576 });
  });

  it('snapEdge runs the guide across the given box when a selection is the moving extent', () => {
    const { file, moverId } = scene();
    const selection = { x: 0, y: 0, width: 500, height: 400 };
    const result = snapEdge(file.document, [moverId], 102, 'x', OPTIONS, selection);
    expect(result.guide).toMatchObject({ axis: 'x', position: 100, from: 0, to: 400 });
  });

  it('snaps a child of a nested frame to the edge of the frame that encloses its parent', () => {
    const file = emptyFile('Nested snap');
    const page = file.document.children[0]!;
    const outer = createFrameNode(null, 0, 0, 400, 300, { name: 'Outer' });
    const inner = createFrameNode(null, 50, 30, 300, 250, { name: 'Inner' });
    const child = createRectNode(null, 60, 60, 60, 40);
    inner.children = [child];
    outer.children = [inner];
    page.children = [outer];
    // The child's left edge is 2 units inside the outer frame's left edge (0); the inner frame's edge (50) is out of reach.
    const result = computeSnap(file.document, [child.id], { x: 2, y: 90, width: 60, height: 40 }, OPTIONS);
    expect(result.dx).toBeCloseTo(-2);
    expect(result.guides.some((entry) => entry.axis === 'x' && entry.position === 0)).toBe(true);
  });
});
