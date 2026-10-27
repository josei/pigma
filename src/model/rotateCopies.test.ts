import { describe, expect, it } from 'vitest';
import { rotateCopies } from './rotateCopies';
import { createRectNode } from './factory';
import { emptyFile } from './validate';
import { findNode, updateNode, worldTransform } from './tree';
import { applyToPoint } from './matrix';
import type { AnyNode, PigmaFile, SceneNode } from './types';

/** A page with rectangles 100 x 50 at the given top-left corners. */
function rectangles(corners: Array<[number, number]>): { file: PigmaFile; ids: string[] } {
  const file = emptyFile('Copies');
  const page = file.document.children[0]!;
  page.children = corners.map(([x, y]) => createRectNode(null, x, y, 100, 50));
  return { file, ids: page.children.map((child) => child.id) };
}

/** The world centre of every layer on the page, rounded so that rotation error does not show. */
function centresOf(file: PigmaFile): Array<{ x: number; y: number }> {
  const layers = file.document.children[0]!.children as SceneNode[];
  return layers.map((layer) => {
    const centre = applyToPoint(worldTransform(file.document, layer.id), 50, 25);
    return { x: Math.round(centre.x * 1000) / 1000, y: Math.round(centre.y * 1000) / 1000 };
  });
}

const byPosition = (a: { x: number; y: number }, b: { x: number; y: number }) => a.x - b.x || a.y - b.y;

describe('rotate copies', () => {
  it('turns the k-th copy k times the angle around the bottom-centre of a single layer', () => {
    // The layer spans x 0..100, y 0..50, so its pivot is (50, 50). Its centre (50, 25) sits 25 above the pivot.
    const { file, ids } = rectangles([[0, 0]]);
    const copied = rotateCopies(file, ids, { count: 3, angle: 90 });
    expect(copied.document.children[0]!.children).toHaveLength(4);
    // Quarter turns of (0, -25) about (50, 50): (75, 50), (50, 75) and (25, 50).
    expect(centresOf(copied).sort(byPosition)).toEqual([
      { x: 25, y: 50 },
      { x: 50, y: 25 },
      { x: 50, y: 75 },
      { x: 75, y: 50 },
    ].sort(byPosition));
  });

  it('leaves the original where it was', () => {
    const { file, ids } = rectangles([[0, 0]]);
    const copied = rotateCopies(file, ids, { count: 2, angle: 45 });
    expect(findNode(copied.document, ids[0]!)).toMatchObject({ transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 } });
  });

  it('turns a group of layers about one shared pivot, the bottom-centre of their combined bounds', () => {
    // Two layers at x 0 and x 200: the bounds span x 0..300 and y 0..50, so the pivot is (150, 50).
    const { file, ids } = rectangles([[0, 0], [200, 0]]);
    const copied = rotateCopies(file, ids, { count: 1, angle: 90 });
    // The first layer's centre (50, 25) is (-100, -25) from the pivot; a quarter turn gives (25, -100), so (175, -50).
    // The second layer's centre (250, 25) is (100, -25) from the pivot, which gives (25, 100), so (175, 150).
    const centres = centresOf(copied);
    expect(centres).toContainEqual({ x: 175, y: -50 });
    expect(centres).toContainEqual({ x: 175, y: 150 });
  });

  it('leaves a locked layer alone, and makes no copies when nothing can be copied', () => {
    const { file, ids } = rectangles([[0, 0]]);
    const locked = { ...file, document: updateNode(file.document, ids[0]!, (node) => ({ ...node, locked: true }) as AnyNode) };
    expect(rotateCopies(locked, ids, { count: 2, angle: 30 })).toBe(locked);
    expect(rotateCopies(file, [], { count: 2, angle: 30 })).toBe(file);
  });

  it('clamps the count to 1 to 99, and ignores a non-finite angle', () => {
    const { file, ids } = rectangles([[0, 0]]);
    expect(rotateCopies(file, ids, { count: 0, angle: 30 }).document.children[0]!.children).toHaveLength(2);
    expect(rotateCopies(file, ids, { count: 500, angle: 1 }).document.children[0]!.children).toHaveLength(100);
    expect(rotateCopies(file, ids, { count: 2, angle: Number.NaN })).toBe(file);
  });
});
