import { describe, expect, it } from 'vitest';
import { NO_SNAP, computeSnap, snapValue } from './snapping';
import { createRectNode } from './factory';
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
});
