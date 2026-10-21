import { describe, expect, it } from 'vitest';
import { cornerSmoothingOf, roundedRectPath } from './SceneRenderer';

const numbers = (path: string) => (path.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

describe('corner smoothing', () => {
  it('at 0 the corners are the circular arcs, exactly as before', () => {
    const path = roundedRectPath(100, 60, [10, 10, 10, 10], 0);
    expect(path).toBe(roundedRectPath(100, 60, [10, 10, 10, 10]));
    expect(path).toContain('A 10 10 0 0 1');
    expect(path).not.toContain('C ');
  });

  it('above 0 every rounded corner is a cubic, not an arc', () => {
    const path = roundedRectPath(100, 60, [10, 10, 10, 10], 1);
    expect(path.match(/C /g)).toHaveLength(4);
    expect(path).not.toContain('A ');
  });

  it('at full smoothing the tangent point sits about 1.53 times the radius from the corner', () => {
    // r = 10, so the curve starts 15.287 along the top edge (10 x 1.5287).
    expect(roundedRectPath(100, 60, [10, 10, 10, 10], 1).startsWith('M 15.287 0 ')).toBe(true);
  });

  it('the extent is clamped to half the shorter side, so a large corner on a small shape cannot overrun', () => {
    // A 20 x 20 box: the half side is 10, below 1.53 x 10.
    expect(roundedRectPath(20, 20, [10, 10, 10, 10], 1).startsWith('M 10 0 ')).toBe(true);
  });

  it('the coordinates stay inside the box', () => {
    const path = roundedRectPath(100, 60, [20, 20, 20, 20], 1);
    for (const value of numbers(path)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  it('a corner with no radius stays sharp, even with smoothing on', () => {
    const path = roundedRectPath(100, 60, [0, 10, 10, 10], 1);
    expect(path.startsWith('M 0 0 ')).toBe(true);
    expect(path.endsWith('L 0 0 Z')).toBe(true);
    expect(path.match(/C /g)).toHaveLength(3);
  });

  it('smoothing is clamped to 0 to 1', () => {
    expect(roundedRectPath(100, 60, [10, 10, 10, 10], 5)).toBe(roundedRectPath(100, 60, [10, 10, 10, 10], 1));
    expect(roundedRectPath(100, 60, [10, 10, 10, 10], -2)).toBe(roundedRectPath(100, 60, [10, 10, 10, 10], 0));
  });

  it('reads a node\'s smoothing, defaulting to 0 and clamping to the range', () => {
    expect(cornerSmoothingOf({} as never)).toBe(0);
    expect(cornerSmoothingOf({ cornerSmoothing: 0.6 } as never)).toBe(0.6);
    expect(cornerSmoothingOf({ cornerSmoothing: 3 } as never)).toBe(1);
  });
});
