import type { RGBA, RGB, Paint, ColorStop, Transform } from './types';
import { fromMatrix, roundTo as round } from './matrix';

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

/** Figma colors are 0..1 floats; CSS wants 0..255 ints. */
export function figmaColorToCss(color: RGB, opacity = 1): string {
  const r = Math.round(clamp01(color.r) * 255);
  const g = Math.round(clamp01(color.g) * 255);
  const b = Math.round(clamp01(color.b) * 255);
  const a = clamp01(opacity);
  return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${round(a, 3)})`;
}

export function toHexChannel(value: number): string {
  return Math.round(clamp01(value) * 255)
    .toString(16)
    .padStart(2, '0');
}

export function rgbaToHex(color: RGBA): string {
  return `#${toHexChannel(color.r)}${toHexChannel(color.g)}${toHexChannel(color.b)}`;
}

export function hexToRgba(hex: string, alpha = 1): RGBA {
  const clean = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{3,8}$/.test(clean)) return { r: 0, g: 0, b: 0, a: alpha };
  const expand = (s: string) => parseInt(s.length === 1 ? s + s : s, 16) / 255;
  if (clean.length === 3 || clean.length === 4) {
    return {
      r: expand(clean[0] ?? '0'),
      g: expand(clean[1] ?? '0'),
      b: expand(clean[2] ?? '0'),
      a: clean.length === 4 ? expand(clean[3] ?? 'f') : alpha,
    };
  }
  if (clean.length === 6 || clean.length === 8) {
    return {
      r: expand(clean.slice(0, 2)),
      g: expand(clean.slice(2, 4)),
      b: expand(clean.slice(4, 6)),
      a: clean.length === 8 ? expand(clean.slice(6, 8)) : alpha,
    };
  }
  return { r: 0, g: 0, b: 0, a: alpha };
}

export function firstVisibleFill(paints: Paint[] | undefined): Paint | null {
  if (!paints) return null;
  for (const paint of paints) if (paint.visible !== false) return paint;
  return null;
}

export function solidPaint(color: RGBA, opacity = 1): Paint {
  return { type: 'SOLID', color: { r: color.r, g: color.g, b: color.b }, opacity: color.a ?? opacity };
}

/** Normalized description of a gradient paint, consumed by both DOM and string renderers. */
export interface GradientSpec {
  id: string;
  kind: 'LINEAR' | 'RADIAL' | 'ANGULAR' | 'DIAMOND';
  stops: ColorStop[];
  matrix: Transform;
}

export function gradientSpec(paint: Paint, id: string): GradientSpec | null {
  switch (paint.type) {
    case 'GRADIENT_LINEAR':
    case 'GRADIENT_RADIAL':
    case 'GRADIENT_ANGULAR':
    case 'GRADIENT_DIAMOND': {
      const kind = paint.type.replace('GRADIENT_', '') as GradientSpec['kind'];
      return {
        id,
        kind,
        stops: [...paint.gradientStops].sort((a, b) => a.position - b.position),
        matrix: paint.gradientTransform ? fromMatrix(paint.gradientTransform) : { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      };
    }
    default:
      return null;
  }
}

export function gradientCssStops(stops: ColorStop[]): string {
  return stops
    .map((stop) => `${figmaColorToCss(stop.color, stop.color.a ?? 1)} ${round(clamp01(stop.position) * 100, 2)}%`)
    .join(', ');
}

/** CSS gradient string for swatch previews in the properties panel. */
export function paintToCssBackground(paint: Paint | null): string {
  if (!paint) return 'transparent';
  switch (paint.type) {
    case 'SOLID':
      return figmaColorToCss(paint.color, paint.opacity ?? 1);
    case 'GRADIENT_LINEAR':
    case 'GRADIENT_RADIAL':
    case 'GRADIENT_ANGULAR':
    case 'GRADIENT_DIAMOND': {
      const stops = gradientCssStops(paint.gradientStops);
      const cssKind = paint.type === 'GRADIENT_LINEAR' ? 'linear-gradient(90deg' : 'radial-gradient(circle at 50% 50%';
      return `${cssKind}, ${stops})`;
    }
    case 'IMAGE':
      return paint.dataUrl ? `url(${paint.dataUrl})` : '#c4c4c4';
    default:
      return 'transparent';
  }
}

