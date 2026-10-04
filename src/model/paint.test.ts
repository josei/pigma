import { describe, expect, it } from 'vitest';
import {
  figmaColorToCss,
  firstVisibleFill,
  gradientCssStops,
  gradientSpec,
  hexToRgba,
  paintToCssBackground,
  rgbaToHex,
  solidPaint,
} from './paint';
import type { Paint } from './types';

describe('paint helpers', () => {
  it('converts Figma 0..1 colors to CSS', () => {
    expect(figmaColorToCss({ r: 1, g: 0, b: 0 })).toBe('rgb(255, 0, 0)');
    expect(figmaColorToCss({ r: 0, g: 0, b: 1 }, 0.5)).toBe('rgba(0, 0, 255, 0.5)');
    expect(figmaColorToCss({ r: 0, g: 0.6, b: 1 })).toBe('rgb(0, 153, 255)');
  });

  it('parses and prints hex colors', () => {
    expect(rgbaToHex(hexToRgba('#0d99ff'))).toBe('#0d99ff');
    expect(rgbaToHex(hexToRgba('#abc'))).toBe('#aabbcc');
    expect(hexToRgba('#00000080').a).toBeCloseTo(0.5, 1);
    expect(hexToRgba('nonsense')).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });

  it('skips hidden paints when picking the first visible fill', () => {
    const hidden: Paint = { type: 'SOLID', color: { r: 0, g: 0, b: 0 }, visible: false };
    const visible = solidPaint({ r: 1, g: 1, b: 1 });
    expect(firstVisibleFill([hidden, visible])).toBe(visible);
    expect(firstVisibleFill([hidden])).toBeNull();
    expect(firstVisibleFill(undefined)).toBeNull();
  });

  it('normalizes gradient specs with sorted stops and an identity default', () => {
    const paint: Paint = {
      type: 'GRADIENT_LINEAR',
      gradientStops: [
        { position: 1, color: { r: 1, g: 1, b: 1 } },
        { position: 0, color: { r: 0, g: 0, b: 0 } },
      ],
    };
    const spec = gradientSpec(paint, 'fill-1');
    expect(spec?.kind).toBe('LINEAR');
    expect(spec?.stops.map((stop) => stop.position)).toEqual([0, 1]);
    expect(spec?.matrix).toEqual({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
    expect(gradientSpec(solidPaint({ r: 1, g: 1, b: 1 }), 'x')).toBeNull();
  });

  it('carries the gradient matrix through unchanged for SVG', () => {
    const paint: Paint = {
      type: 'GRADIENT_LINEAR',
      gradientStops: [{ position: 0, color: { r: 0, g: 0, b: 0 } }],
      gradientTransform: [
        [0, -1, 0],
        [1, 0, 0],
      ],
    };
    expect(gradientSpec(paint, 'g')?.matrix).toEqual({ a: 0, b: 1, c: -1, d: 0, tx: 0, ty: 0 });
  });

  it('renders CSS previews for every paint kind', () => {
    expect(paintToCssBackground(solidPaint({ r: 1, g: 0, b: 0 }))).toBe('rgb(255, 0, 0)');
    expect(paintToCssBackground(null)).toBe('transparent');
    const gradient: Paint = {
      type: 'GRADIENT_RADIAL',
      gradientStops: [
        { position: 0, color: { r: 0, g: 0, b: 0 } },
        { position: 1, color: { r: 1, g: 1, b: 1 } },
      ],
    };
    expect(paintToCssBackground(gradient)).toContain('radial-gradient');
    expect(gradientCssStops(gradient.gradientStops)).toBe('rgb(0, 0, 0) 0%, rgb(255, 255, 255) 100%');
    const image: Paint = { type: 'IMAGE', imageRef: 'ref', dataUrl: 'data:image/png;base64,AAA' };
    expect(paintToCssBackground(image)).toContain('data:image/png');
    expect(paintToCssBackground({ type: 'IMAGE' })).toBe('#c4c4c4');
  });
});
