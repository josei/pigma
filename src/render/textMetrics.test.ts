import { describe, expect, it } from 'vitest';
import type { TextStyle } from '../model/types';
import { layoutText, measureLine } from './textMetrics';

const style: TextStyle = { fontFamily: 'Inter', fontSize: 14, lineHeight: { unit: 'PERCENT', value: 120 } };

describe('text lists', () => {
  it('leaves paragraphs alone without a list', () => {
    expect(layoutText('one\ntwo', style).lines).toEqual(['one', 'two']);
  });

  it('puts a bullet in front of each non-empty paragraph', () => {
    expect(layoutText('one\n\ntwo', { ...style, listType: 'UNORDERED' }).lines).toEqual(['• one', '', '• two']);
  });

  it('numbers only the paragraphs that carry text', () => {
    expect(layoutText('one\n\ntwo', { ...style, listType: 'ORDERED' }).lines).toEqual(['1. one', '', '2. two']);
  });

  it('measures the marker, so an auto-width box fits it', () => {
    const plain = layoutText('one', style).width;
    const listed = layoutText('one', { ...style, listType: 'ORDERED' }).width;
    expect(listed).toBeGreaterThan(plain);
  });
});

describe('wrapped list items', () => {
  it('hangs a wrapped line under the text, not under the marker', () => {
    const words = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu';
    const layout = layoutText(words, { ...style, listType: 'UNORDERED' }, 90, true);
    expect(layout.lines.length).toBeGreaterThan(1);
    expect(layout.lines[0]!.startsWith('• ')).toBe(true);
    // Continuation lines start with the indent (non-breaking spaces), never a bullet.
    for (const line of layout.lines.slice(1)) {
      expect(line.startsWith(' ')).toBe(true);
      expect(line).not.toContain('•');
    }
  });

  it('keeps every wrapped line inside the box', () => {
    const words = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu';
    const layout = layoutText(words, { ...style, listType: 'ORDERED' }, 90, true);
    for (const line of layout.lines) expect(measureLine(line, style)).toBeLessThanOrEqual(90 + 1);
  });
});
