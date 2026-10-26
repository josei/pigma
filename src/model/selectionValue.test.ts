import { describe, expect, it } from 'vitest';
import { canonicalKey, isMixedValue } from './selectionValue';

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

describe('canonicalKey: a stable key for structured values', () => {
  it('is the same for equal values whose keys were written in a different order', () => {
    const a = { type: 'DROP_SHADOW', radius: 4, color: { r: 0, g: 0, b: 0, a: 0.25 } };
    const b = { color: { b: 0, a: 0.25, g: 0, r: 0 }, radius: 4, type: 'DROP_SHADOW' };
    expect(canonicalKey(a)).toBe(canonicalKey(b));
  });

  it('keeps array order, since an effect list is ordered', () => {
    expect(canonicalKey([1, 2])).not.toBe(canonicalKey([2, 1]));
  });

  it('tells apart values that differ, and treats an undefined field as absent', () => {
    expect(canonicalKey({ radius: 4 })).not.toBe(canonicalKey({ radius: 5 }));
    expect(canonicalKey({ radius: 4, spread: undefined })).toBe(canonicalKey({ radius: 4 }));
    expect(canonicalKey([])).toBe('[]');
  });
});

