import { describe, expect, it } from 'vitest';
import { createTextNode } from '../model/factory';
import type { TextNode } from '../model/types';
import { commandsToPathData, faceFor, interBytes, outlineRefusal, textOutline } from './textOutline';
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

describe('the bundled fonts', () => {
  it('are Inter Regular and Inter Bold, both WOFFs', () => {
    for (const face of ['regular', 'bold'] as const) {
      const bytes = interBytes(face);
      expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('wOFF');
      expect(new Uint8Array(bytes).length).toBeGreaterThan(20_000);
    }
    expect(interBytes('bold').byteLength).not.toBe(interBytes('regular').byteLength);
  });

  it('picks Bold for weights 600 and up, and Regular otherwise', () => {
    expect(faceFor({ fontSize: 16, fontFamily: 'Inter', fontWeight: 700 } as TextNode['style'])).toBe('bold');
    expect(faceFor({ fontSize: 16, fontFamily: 'Inter', fontWeight: 600 } as TextNode['style'])).toBe('bold');
    expect(faceFor({ fontSize: 16, fontFamily: 'Inter', fontWeight: 400 } as TextNode['style'])).toBe('regular');
    expect(faceFor({ fontSize: 16, fontFamily: 'Inter', fontStyle: 'Bold' } as TextNode['style'])).toBe('bold');
  });

  it('outlines bold text wider than regular text of the same characters', () => {
    const regular = boundsOf(textOutline(textOf('HHHH'))!);
    const bold = boundsOf(textOutline(textOf('HHHH', { fontWeight: 700 }))!);
    expect(bold.maxX).toBeGreaterThan(regular.maxX);
  });
});

describe('text decoration', () => {
  it('underlines a line with a bar whose top is the font underline position', () => {
    const plain = textOf('H');
    const underlined = textOf('H', { textDecoration: 'UNDERLINE' });
    const baseline = firstBaselineOffset(plain.style);
    // Inter Regular: underline top at -348 units, thickness 140, on a 2048 em.
    const barBottom = baseline + ((348 + 140) / 2048) * 16;
    expect(boundsOf(textOutline(underlined)!).maxY).toBeCloseTo(barBottom, 2);
    expect(boundsOf(textOutline(plain)!).maxY).toBeCloseTo(baseline, 2);
  });

  it('strikes through a line at the font strikeout position', () => {
    const struck = textOf('H', { textDecoration: 'STRIKETHROUGH' });
    const baseline = firstBaselineOffset(struck.style);
    const barTop = baseline - (671 / 2048) * 16;
    const path = textOutline(struck)!;
    // The bar's top edge is one of the path's y coordinates.
    const ys = (path.match(/-?\d+(\.\d+)?/g) ?? []).map(Number).filter((_, index) => index % 2 === 1);
    expect(ys.some((y) => Math.abs(y - barTop) < 0.01)).toBe(true);
  });

  it('draws no bar under text with no decoration', () => {
    expect(textOutline(textOf('H'))!.match(/M/g)).toHaveLength(1);
    expect(textOutline(textOf('H', { textDecoration: 'UNDERLINE' }))!.match(/M/g)).toHaveLength(2);
  });

  it('does not draw a bar under an empty line', () => {
    expect(textOutline(textOf('', { textDecoration: 'UNDERLINE' }))).toBeNull();
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

describe('outlineRefusal', () => {
  it('allows Inter text, including the list markers and the ellipsis Inter has', () => {
    expect(outlineRefusal(textOf('Hello • café… €'))).toBeNull();
    expect(outlineRefusal(textOf('a\nb'))).toBeNull();
  });

  it('refuses a layer in another family, and says what to change', () => {
    expect(outlineRefusal(textOf('Hi', { fontFamily: 'Georgia' }))).toMatch(/Inter text only.*"Georgia".*Set the font to Inter/);
  });

  it('refuses a character Inter has no glyph for, and names it', () => {
    expect(outlineRefusal(textOf('日本'))).toMatch(/no glyph for "日"/);
    expect(outlineRefusal(textOf('ж'))).toMatch(/no glyph for "ж"/);
  });
});

describe('a bold run in an outline', () => {
  it('outlines a run in the bold face: a run that covers the whole layer matches a bold layer', () => {
    const plain = textOf('docs');
    const runBold = { ...textOf('docs'), textRanges: [{ start: 0, end: 4, fontWeight: 700 }] };
    const layerBold = textOf('docs', { fontWeight: 700 });
    expect(textOutline(runBold)).toBe(textOutline(layerBold));
    expect(textOutline(runBold)).not.toBe(textOutline(plain));
  });

  it('draws only the run in the bold face, and the rest in the layer face', () => {
    const plain = textOutline(textOf('Read the docs'))!;
    const partial = textOutline({ ...textOf('Read the docs'), textRanges: [{ start: 9, end: 13, fontWeight: 700 }] })!;
    expect(partial).not.toBe(plain);
    // The bold word is wider, so the outline reaches further right than the plain one.
    expect(boundsOf(partial).maxX).toBeGreaterThan(boundsOf(plain).maxX);
  });
});
