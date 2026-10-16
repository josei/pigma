import { describe, expect, it } from 'vitest';
import { gradientAngle, gradientEnds, radialHandles, radialPlacement, withGradientAngle, withGradientEnds, withRadialHandle, withRadialPlacement } from './paint';
import type { GradientPaint } from './types';

const linear: GradientPaint = {
  type: 'GRADIENT_LINEAR',
  gradientStops: [
    { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
    { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } },
  ],
  gradientTransform: [[1, 0, 0], [0, 1, 0]],
};

describe('gradient angle', () => {
  it('reads 0 for the default left-to-right gradient', () => {
    expect(gradientAngle(linear)).toBe(0);
  });

  it('round-trips a set angle', () => {
    for (const degrees of [30, 90, 180, -45]) {
      expect(gradientAngle(withGradientAngle(linear, degrees))).toBe(degrees);
    }
  });

  it('keeps the gradient centred on the box when turned', () => {
    const turned = withGradientAngle(linear, 90) as GradientPaint;
    const [[a, c, tx], [b, d, ty]] = turned.gradientTransform!;
    // The centre (0.5, 0.5) maps to itself.
    expect(a! * 0.5 + c! * 0.5 + tx!).toBeCloseTo(0.5, 9);
    expect(b! * 0.5 + d! * 0.5 + ty!).toBeCloseTo(0.5, 9);
  });

  it('leaves solid and radial paints alone', () => {
    const radial = { ...linear, type: 'GRADIENT_RADIAL' as const };
    expect(withGradientAngle(radial, 90)).toBe(radial);
    expect(gradientAngle(radial)).toBe(0);
  });
});

describe('radial placement', () => {
  const radial = { ...linear, type: 'GRADIENT_RADIAL' as const };

  it('reads the default as centred and full size', () => {
    expect(radialPlacement(radial)).toEqual({ centreX: 50, centreY: 50, width: 100, height: 100 });
  });

  it('round-trips a moved centre and a resized ellipse', () => {
    const moved = withRadialPlacement(radial, { centreX: 25, centreY: 70, width: 60, height: 40 });
    expect(radialPlacement(moved)).toEqual({ centreX: 25, centreY: 70, width: 60, height: 40 });
  });
});

describe('gradient ends', () => {
  it('reads the default ends at the middle of the left and right edges', () => {
    expect(gradientEnds(linear)).toEqual({ start: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 } });
  });

  it('round-trips moved ends', () => {
    const moved = withGradientEnds(linear, { x: 0.2, y: 0.3 }, { x: 0.8, y: 0.9 });
    const ends = gradientEnds(moved)!;
    expect(ends.start.x).toBeCloseTo(0.2, 9);
    expect(ends.start.y).toBeCloseTo(0.3, 9);
    expect(ends.end.x).toBeCloseTo(0.8, 9);
    expect(ends.end.y).toBeCloseTo(0.9, 9);
  });
});

describe('radial handles', () => {
  const radial = { ...linear, type: 'GRADIENT_RADIAL' as const };

  it('places the handles at the centre and the middle of each side', () => {
    expect(radialHandles(radial)).toEqual({ centre: { x: 0.5, y: 0.5 }, right: { x: 1, y: 0.5 }, bottom: { x: 0.5, y: 1 } });
  });

  it('moves the centre, and sets an axis radius from the side handle', () => {
    const moved = withRadialHandle(radial, 'centre', { x: 0.3, y: 0.6 });
    expect(radialPlacement(moved)).toMatchObject({ centreX: 30, centreY: 60, width: 100, height: 100 });
    const widened = withRadialHandle(radial, 'right', { x: 0.75, y: 0.5 });
    expect(radialPlacement(widened).width).toBe(50);
    expect(radialPlacement(widened).height).toBe(100);
  });
});
