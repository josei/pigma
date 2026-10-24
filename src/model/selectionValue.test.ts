import { describe, expect, it } from 'vitest';
import { isMixedValue } from './selectionValue';

describe('isMixedValue: a property across several layers', () => {
  it('is not mixed for one layer or for layers that share the value', () => {
    expect(isMixedValue([0.5])).toBe(false);
    expect(isMixedValue([0.5, 0.5, 0.5])).toBe(false);
    expect(isMixedValue([])).toBe(false);
  });

  it('is mixed as soon as one layer differs', () => {
    expect(isMixedValue([1, 0.5])).toBe(true);
    expect(isMixedValue([0.5, 0.5, 1])).toBe(true);
  });
});
