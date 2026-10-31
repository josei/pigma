import { describe, expect, it } from 'vitest';
import { miterLimitFromAngle } from '../../src/figma/convert/adapters';

describe('miter angle from the REST API', () => {
  it('turns a miter angle into the limit it stands for: the ratio of the miter tip to the half width', () => {
    // A 60 degree corner has a miter ratio of 1 / sin(30 degrees) = 2; a 90 degree corner is root 2; the default angle of 28.955 is about 4.
    expect(miterLimitFromAngle(60)).toBe(2);
    expect(miterLimitFromAngle(90)).toBeCloseTo(Math.SQRT2, 3);
    expect(miterLimitFromAngle(28.955)).toBeCloseTo(4, 1);
  });

  it('has no limit for an angle outside (0, 180) degrees', () => {
    expect(miterLimitFromAngle(0)).toBeNull();
    expect(miterLimitFromAngle(180)).toBeNull();
    expect(miterLimitFromAngle(Number.NaN)).toBeNull();
  });
});
