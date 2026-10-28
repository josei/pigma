import { describe, expect, it } from 'vitest';
import { ARROW_HEAD_LENGTH, arrowheadPaths, arrowheadsOf, isArrowCap } from './arrowheads';

/** A line from the origin to (100, 0), at a stroke weight of 2: each head is ARROW_HEAD_LENGTH x 2 = 10 long. */
const line = [
  [
    [0, 0],
    [100, 0],
  ],
] as Array<Array<[number, number]>>;

describe('arrowheads', () => {
  it('knows the two arrow caps and no other', () => {
    expect(isArrowCap('ARROW_LINES')).toBe(true);
    expect(isArrowCap('ARROW_EQUILATERAL')).toBe(true);
    expect(isArrowCap('ROUND')).toBe(false);
    expect(isArrowCap(undefined)).toBe(false);
  });

  it('gives an equilateral head at each end, its tip on the end point and its base back along the path', () => {
    expect(ARROW_HEAD_LENGTH).toBe(5);
    const { heads, arms } = arrowheadsOf(line, 'ARROW_EQUILATERAL', 2);
    expect(arms).toEqual([]);
    expect(heads).toHaveLength(2);
    // The start: tip at the origin, the base 10 along the line, and half as wide as 10 / root 3.
    expect(heads[0]![0]).toEqual([0, 0]);
    expect(heads[0]![1]![0]).toBeCloseTo(10, 9);
    expect(Math.abs(heads[0]![1]![1]!)).toBeCloseTo(10 / Math.sqrt(3), 9);
    expect(heads[0]![1]![1]).toBeCloseTo(-heads[0]![2]![1]!, 9);
    // The end: tip at (100, 0), the base at (90, 0).
    expect(heads[1]![0]).toEqual([100, 0]);
    expect(heads[1]![1]![0]).toBeCloseTo(90, 9);
  });

  it('gives a chevron of two arms at each end, meeting at the end point, each 10 long', () => {
    const { arms, heads } = arrowheadsOf(line, 'ARROW_LINES', 2);
    expect(heads).toEqual([]);
    expect(arms).toHaveLength(2);
    const end = arms[1]!;
    expect(end[1]).toEqual([100, 0]);
    // Each arm leaves the tip at 30 degrees from the path, so it is 10 long and reaches back 10 cos 30 and out 10 sin 30.
    expect(end[0]![0]).toBeCloseTo(100 - 10 * Math.cos(Math.PI / 6), 9);
    expect(Math.abs(end[0]![1]!)).toBeCloseTo(10 * Math.sin(Math.PI / 6), 9);
    expect(end[2]![1]).toBeCloseTo(-end[0]![1]!, 9);
  });

  it('ignores a polyline with one point, and an end whose segment has no length', () => {
    expect(arrowheadsOf([[[5, 5]]], 'ARROW_EQUILATERAL', 2).heads).toEqual([]);
    expect(
      arrowheadsOf(
        [
          [
            [5, 5],
            [5, 5],
          ],
        ],
        'ARROW_LINES',
        2,
      ).arms,
    ).toEqual([]);
  });

  it('writes the heads as closed path data and the arms as open path data', () => {
    const paths = arrowheadPaths(line, 'ARROW_EQUILATERAL', 2);
    expect(paths.arms).toBe('');
    expect(paths.heads.startsWith('M 0 0 L ')).toBe(true);
    expect(paths.heads.endsWith(' Z')).toBe(true);
    const arms = arrowheadPaths(line, 'ARROW_LINES', 2);
    expect(arms.heads).toBe('');
    expect(arms.arms.includes('Z')).toBe(false);
  });
});
