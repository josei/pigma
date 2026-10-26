import { describe, expect, it } from 'vitest';
import { layoutText, measureLine, measureRuns } from './textMetrics';
import type { TextStyle } from '../model/types';

const style: TextStyle = { fontFamily: 'Inter', fontSize: 14, lineHeight: { unit: 'AUTO' } };

describe('measuring text made of runs', () => {
  it('adds the widths of its parts, each at its own weight', () => {
    const bold = { ...style, fontWeight: 700 };
    expect(measureRuns([{ text: 'Read ' }, { text: 'docs', fontWeight: 700 }], style)).toBeCloseTo(
      measureLine('Read ', style) + measureLine('docs', bold),
      6,
    );
  });

  it('measures a single plain part as the whole line', () => {
    expect(measureRuns([{ text: 'Read the docs' }], style)).toBeCloseTo(measureLine('Read the docs', style), 6);
  });

  it('wraps the same way with and without runs where the weight does not change the width (no canvas)', () => {
    const characters = 'alpha beta gamma delta epsilon zeta eta theta iota kappa';
    const plain = layoutText(characters, style, 60, true);
    const runs = layoutText(characters, style, 60, true, [{ start: 6, end: 10, fontWeight: 700 }]);
    expect(runs.lines).toEqual(plain.lines);
    expect(runs.sources).toEqual(plain.sources);
  });
});
