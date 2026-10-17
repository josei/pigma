import { describe, expect, it } from 'vitest';
import { createTextNode } from '../model/factory';
import type { TextNode } from '../model/types';
import { commandsToPathData, interRegularBytes, textOutline } from './textOutline';
import { firstBaselineOffset } from './textMetrics';

/** Bounds of a path made of M/L/C/Z. Control points count, so this is exact for straight glyphs. */
function boundsOf(pathData: string): { minX: number; minY: number; maxX: number; maxY: number } {
  const numbers = (pathData.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  const xs = numbers.filter((_, index) => index % 2 === 0);
  const ys = numbers.filter((_, index) => index % 2 === 1);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

function textOf(characters: string, style: Partial<TextNode['style']> = {}, width = 200): TextNode {
  const node = createTextNode(null, 0, 0, characters, { fontSize: 16, ...style }) as TextNode;
  return { ...node, width };
}

describe('the bundled font', () => {
  it('is Inter Regular, a WOFF that the outliner parses', () => {
    const bytes = interRegularBytes();
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('wOFF');
    expect(new Uint8Array(bytes).length).toBeGreaterThan(20_000);
  });
});

describe('textOutline', () => {
  it('draws the glyphs on the baseline the canvas text uses, at the cap height', () => {
    const node = textOf('H');
    const path = textOutline(node)!;
    const bounds = boundsOf(path);
    const baseline = firstBaselineOffset(node.style);
    // Inter's cap height is 0.727 em.
    expect(bounds.maxY).toBeCloseTo(baseline, 1);
    expect(bounds.minY).toBeCloseTo(baseline - 0.727 * 16, 1);
    expect(bounds.minX).toBeGreaterThan(0);
  });

  it('writes only absolute M, L, C and Z, the commands the path model understands', () => {
    const path = textOutline(textOf('Quadratic curves: SO&g?'))!;
    expect(path.replace(/[-\d.\s]/g, '')).toMatch(/^[MLCZ]+$/);
    expect(path).not.toMatch(/[Qq]/);
  });

  it('returns null for empty text, which has no glyphs to draw', () => {
    expect(textOutline(textOf(''))).toBeNull();
  });

  it('centres a centred line in the box', () => {
    const node = textOf('H', { textAlignHorizontal: 'CENTER' }, 200);
    const bounds = boundsOf(textOutline(node)!);
    // Inter's H has equal side bearings, so the ink centre is the advance centre.
    expect((bounds.minX + bounds.maxX) / 2).toBeCloseTo(100, 1);
  });

  it('aligns a right-aligned line to the right edge', () => {
    const node = textOf('H', { textAlignHorizontal: 'RIGHT' }, 200);
    const bounds = boundsOf(textOutline(node)!);
    expect(bounds.maxX).toBeLessThanOrEqual(200);
    expect(bounds.maxX).toBeGreaterThan(190);
  });

  it('widens with letter spacing, as the canvas text does', () => {
    const plain = boundsOf(textOutline(textOf('HHHH'))!);
    const spaced = boundsOf(textOutline(textOf('HHHH', { letterSpacing: { unit: 'PIXELS', value: 10 } }))!);
    // Three gaps of 10 px between four letters.
    expect(spaced.maxX - plain.maxX).toBeCloseTo(30, 0);
  });

  it('puts each line one line height below the one before', () => {
    const single = boundsOf(textOutline(textOf('H', { lineHeight: { unit: 'PIXELS', value: 20 } }))!);
    const double = boundsOf(textOutline(textOf('H\nH', { lineHeight: { unit: 'PIXELS', value: 20 } }))!);
    expect(double.maxY - single.maxY).toBeCloseTo(20, 1);
  });
});

describe('commandsToPathData', () => {
  it('raises a quadratic curve to the same cubic', () => {
    // A quadratic from (0,0) with control (10,0) to (10,10) is the cubic with controls
    // (20/3,0) and (10,10/3).
    const data = commandsToPathData([
      { type: 'M', x: 0, y: 0 },
      { type: 'Q', x1: 10, y1: 0, x: 10, y: 10 },
      { type: 'Z' },
    ]);
    expect(data).toBe('M0 0 C6.667 0 10 3.333 10 10 Z');
  });
});
