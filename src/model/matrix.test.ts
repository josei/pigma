import { describe, expect, it } from 'vitest';
import {
  IDENTITY,
  applyToPoint,
  boundsOf,
  fromMatrix,
  fromTRS,
  invert,
  multiply,
  rotationOf,
  toMatrix,
  transformToCss,
  withRotation,
} from './matrix';
import { createRectNode, createTextNode } from './factory';

describe('transform math', () => {
  it('composes translations and rotations in parent space', () => {
    const parent = fromTRS(100, 50, 90);
    const child = fromTRS(10, 0, 0);
    const world = multiply(parent, child);
    const point = applyToPoint(world, 0, 0);
    expect(point.x).toBeCloseTo(100);
    expect(point.y).toBeCloseTo(60);
    expect(rotationOf(world)).toBeCloseTo(90);
  });

  it('round-trips Figma relativeTransform matrices', () => {
    const transform = fromTRS(12, -4, 30);
    const restored = fromMatrix(toMatrix(transform));
    expect(restored.a).toBeCloseTo(transform.a);
    expect(restored.b).toBeCloseTo(transform.b);
    expect(restored.c).toBeCloseTo(transform.c);
    expect(restored.d).toBeCloseTo(transform.d);
    expect(restored.tx).toBeCloseTo(transform.tx);
    expect(restored.ty).toBeCloseTo(transform.ty);
  });

  it('inverts transforms so world <-> local conversions agree', () => {
    const transform = fromTRS(40, 90, 25, 2, 3);
    const inverse = invert(transform);
    const point = applyToPoint(transform, 17, 23);
    const back = applyToPoint(inverse, point.x, point.y);
    expect(back.x).toBeCloseTo(17);
    expect(back.y).toBeCloseTo(23);
  });

  it('computes axis-aligned bounds of a rotated box', () => {
    const node = createRectNode(null, 0, 0, 100, 50);
    const rotated = fromTRS(10, 10, 90);
    const bounds = boundsOf(rotated, node.width, node.height);
    expect(bounds.width).toBeCloseTo(50);
    expect(bounds.height).toBeCloseTo(100);
    expect(bounds.x).toBeCloseTo(-40);
    expect(bounds.y).toBeCloseTo(10);
  });

  it('replaces rotation while keeping scale and translation', () => {
    const scaled = fromTRS(5, 6, 0, 2, 4);
    const rotated = withRotation(scaled, 90);
    expect(rotationOf(rotated)).toBeCloseTo(90);
    expect(rotated.tx).toBe(5);
    expect(rotated.ty).toBe(6);
    expect(Math.hypot(rotated.a, rotated.b)).toBeCloseTo(2);
  });

  it('serializes to a CSS matrix', () => {
    expect(transformToCss(IDENTITY)).toBe('matrix(1, 0, 0, 1, 0, 0)');
  });

  it('keeps text nodes measurable in a DOM-less environment', () => {
    const node = createTextNode(null, 0, 0, 'Hello');
    expect(node.style.fontSize).toBe(14);
    expect(node.width).toBeGreaterThan(0);
  });
});
