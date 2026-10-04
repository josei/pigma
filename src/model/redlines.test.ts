import { describe, expect, it } from 'vitest';
import { distanceBetween, formatMeasure, redlinesFor } from './redlines';
import { emptyFile } from './validate';
import { createFrameNode, createRectNode } from './factory';
import type { PigmaFile, SceneNode } from './types';

function scene() {
  const file = emptyFile('Redlines');
  const page = file.document.children[0]!;
  const frame = createFrameNode(null, 100, 50, 400, 300, { name: 'Frame' });
  const target = createRectNode(null, 40, 30, 120, 80);
  target.name = 'Target';
  const left = createRectNode(null, 0, 30, 30, 80);
  left.name = 'Left';
  const right = createRectNode(null, 200, 30, 50, 80);
  right.name = 'Right';
  const farRight = createRectNode(null, 350, 30, 40, 80);
  farRight.name = 'Far right';
  const above = createRectNode(null, 40, 0, 120, 20);
  above.name = 'Above';
  frame.children = [left, target, right, farRight, above];
  page.children = [frame];
  return { file, frameId: frame.id, targetId: target.id, leftId: left.id, rightId: right.id, aboveId: above.id };
}

describe('redlines', () => {
  it('measures size and parent spacing', () => {
    const { file, targetId } = scene();
    const red = redlinesFor(file, targetId)!;
    expect(red.width).toBe(120);
    expect(red.height).toBe(80);
    // Frame at (100,50); target at frame-local (40,30) -> absolute (140,80).
    expect(red.bounds).toMatchObject({ x: 140, y: 80, width: 120, height: 80 });
    expect(red.parent!.left).toMatchObject({ distance: 40, from: 100, to: 140 });
    expect(red.parent!.right).toMatchObject({ distance: 240 });
    expect(red.parent!.top).toMatchObject({ distance: 30 });
    expect(red.parent!.bottom).toMatchObject({ distance: 190 });
  });

  it('reports the nearest sibling per side', () => {
    const { file, targetId } = scene();
    const red = redlinesFor(file, targetId)!;
    const bySide = Object.fromEntries(red.siblings.map((sibling) => [sibling.side, sibling]));
    // Left: 30 wide ending at 130 -> gap to 140 is 10.
    expect(bySide.left).toMatchObject({ name: 'Left', distance: 10, from: 130, to: 140 });
    // Right: nearest of the two right-hand boxes is at 200+... (frame-local 200 -> 300 absolute).
    expect(bySide.right).toMatchObject({ name: 'Right', distance: 40, from: 260, to: 300 });
    // Above: 20 tall ending at absolute 70 -> gap to 80 is 10.
    expect(bySide.top).toMatchObject({ name: 'Above', distance: 10 });
    expect(bySide.bottom).toBeUndefined();
    expect(red.siblings).toHaveLength(3);
  });

  it('ignores siblings that are not aligned on the measuring axis', () => {
    const file = emptyFile('Diagonal');
    const page = file.document.children[0]!;
    const target = createRectNode(null, 0, 0, 50, 50);
    const diagonal = createRectNode(null, 200, 200, 50, 50);
    page.children = [target, diagonal];
    const red = redlinesFor(file, target.id)!;
    // Neither box overlaps the other on either axis, so there is nothing to measure.
    expect(red.siblings).toEqual([]);
    expect(red.parent).toBeNull();
  });

  it('measures a node directly on a page without a parent spacing', () => {
    const file = emptyFile('Page');
    const page = file.document.children[0]!;
    const rect = createRectNode(null, 10, 10, 20, 30);
    page.children = [rect];
    const red = redlinesFor(file, rect.id)!;
    expect(red.width).toBe(20);
    expect(red.parent).toBeNull();
    expect(red.siblings).toEqual([]);
  });

  it('returns null for unknown ids and non-scene nodes', () => {
    const { file } = scene();
    expect(redlinesFor(file, 'missing')).toBeNull();
    expect(redlinesFor(file, file.document.id)).toBeNull();
    expect(redlinesFor(file, file.document.children[0]!.id)).toBeNull();
  });

  it('measures distances between two nodes and formats values', () => {
    const { file, leftId, rightId } = scene();
    // Left ends at 130, right starts at 300 -> 170 apart on x, aligned on y.
    expect(distanceBetween(file, leftId, rightId)).toBe(170);
    expect(distanceBetween(file, leftId, 'missing')).toBeNull();
    expect(formatMeasure(12.4)).toBe('12');
    expect(formatMeasure(12.6)).toBe('13');
  });

  it('measures nested nodes through frames with their own transforms', () => {
    const file: PigmaFile = emptyFile('Nested');
    const page = file.document.children[0]!;
    const outer = createFrameNode(null, 10, 10, 300, 300, { name: 'Outer' });
    const inner = createFrameNode(null, 20, 20, 100, 100, { name: 'Inner' });
    const child: SceneNode = createRectNode(null, 5, 5, 10, 10);
    inner.children = [child];
    outer.children = [inner];
    page.children = [outer];
    const red = redlinesFor(file, child.id)!;
    // Outer (10,10) + inner (20,20) + child (5,5) -> absolute (35,35).
    expect(red.bounds).toMatchObject({ x: 35, y: 35, width: 10, height: 10 });
    expect(red.parent!.left!.distance).toBe(5);
    expect(red.parent!.top!.distance).toBe(5);
  });
});
