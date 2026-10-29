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

/**
 * What one paint row shows for a selection: nothing, the same paint on every layer, or several different paints
 * (`mixed`, listed once each, with `null` for a layer that has no paint).
 */
export type SelectionPaint =
  | { kind: 'none' }
  | { kind: 'same'; paint: Paint }
  | { kind: 'mixed'; paints: Array<Paint | null> };

/** A paint's identity for comparison: a solid by its colour, alpha and opacity, any other paint by its content. */
function paintIdentity(paint: Paint): string {
  if (paint.type === 'SOLID') return `SOLID ${rgbaToHex(paint.color as RGBA)} ${(paint.color as RGBA).a ?? 1} ${paint.opacity ?? 1}`;
  return JSON.stringify(paint);
}

/**
 * Reduce each selected layer's first visible paint (or `null`) to one row value. A paint that every layer shares is
 * `same`; any difference, including some layers having no paint, is `mixed`.
 */
export function selectionPaintOf(paints: Array<Paint | null>): SelectionPaint {
  if (paints.every((paint) => paint === null)) return { kind: 'none' };
  const distinct = new Map<string, Paint | null>();
  for (const paint of paints) distinct.set(paint ? paintIdentity(paint) : 'NONE', paint);
  if (distinct.size === 1) return { kind: 'same', paint: paints[0] as Paint };
  return { kind: 'mixed', paints: [...distinct.values()] };
}

/** One solid colour in a selection: the hex it shows, and how many layers carry it in a fill or a stroke. */
export interface SelectionColour {
  hex: string;
  layers: number;
}

/**
 * The solid colours of a selection's visible fills and strokes, most used first (ties by hex). A layer counts once for
 * each colour, however many of its paints show it. Gradients and images are not colours here, and neither is a hidden
 * paint. The opacity of a paint is not part of its colour.
 */
export function selectionColours(layers: Array<{ fills?: Paint[]; strokes?: Paint[] }>): SelectionColour[] {
  const counts = new Map<string, number>();
  for (const layer of layers) {
    const hexes = new Set<string>();
    for (const paint of [...(layer.fills ?? []), ...(layer.strokes ?? [])]) {
      if (paint.type !== 'SOLID' || paint.visible === false) continue;
      hexes.add(rgbaToHex(paint.color as RGBA));
    }
    for (const hex of hexes) counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  return [...counts]
    .map(([hex, count]) => ({ hex, layers: count }))
    .sort((a, b) => b.layers - a.layers || a.hex.localeCompare(b.hex));
}

/**
 * The paints with one colour changed: each visible solid whose colour is `from` takes the channels of `to`, and keeps its
 * opacity, visibility and blend. Every other paint is returned as it was, and the same array comes back when nothing
 * changes. `from` is a hex as `selectionColours` lists it, and only visible solids match, as the list counts them.
 */
export function recolourPaints(paints: Paint[], from: string, to: RGBA): Paint[] {
  const matches = (paint: Paint) => paint.type === 'SOLID' && paint.visible !== false && rgbaToHex(paint.color as RGBA) === from;
  if (!paints.some(matches)) return paints;
  return paints.map((paint) => (matches(paint) ? { ...paint, color: { r: to.r, g: to.g, b: to.b } } : paint));
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
      // The canvas's own shapes: a linear ramp left to right, a radial ellipse with half the box as its radii, and a conic gradient from
      // the top of the box, clockwise. CSS has no diamond, so a diamond keeps the circular radial it always had.
      if (paint.type === 'GRADIENT_LINEAR') return `linear-gradient(90deg, ${stops})`;
      if (paint.type === 'GRADIENT_RADIAL') return `radial-gradient(ellipse 50% 50% at 50% 50%, ${stops})`;
      if (paint.type === 'GRADIENT_ANGULAR') return `conic-gradient(from 0deg at 50% 50%, ${stops})`;
      return `radial-gradient(circle at 50% 50%, ${stops})`;
    }
    case 'IMAGE':
      return paint.dataUrl ? `url(${paint.dataUrl})` : '#c4c4c4';
    default:
      return 'transparent';
  }
}



/**
 * A linear gradient's direction, in degrees: 0 runs left to right (the default), and
 * the angle turns it about the middle of the box.
 */
export function gradientAngle(paint: Paint): number {
  if (paint.type !== 'GRADIENT_LINEAR') return 0;
  const { a, b } = fromMatrix(paint.gradientTransform ?? [[1, 0, 0], [0, 1, 0]]);
  return Math.round((Math.atan2(b, a) * 180) / Math.PI);
}

/** The same gradient turned to `degrees`, still centred on the box. */
export function withGradientAngle(paint: Paint, degrees: number): Paint {
  if (paint.type !== 'GRADIENT_LINEAR') return paint;
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  // Rotate about (0.5, 0.5): p' = R(p - c) + c.
  const tx = 0.5 - 0.5 * cos + 0.5 * sin;
  const ty = 0.5 - 0.5 * sin - 0.5 * cos;
  return { ...paint, gradientTransform: [[cos, -sin, tx], [sin, cos, ty]] };
}

/**
 * A radial gradient's placement, as percentages of its box: the centre, and the width
 * and height of the ellipse it spans (100% reaches the box's edges). Stored as the
 * transform `matrix(sx 0 0 sy tx ty)` in normalized box space.
 */
export interface RadialPlacement {
  centreX: number;
  centreY: number;
  width: number;
  height: number;
}

export function radialPlacement(paint: Paint): RadialPlacement {
  const fallback = { centreX: 50, centreY: 50, width: 100, height: 100 };
  if (paint.type !== 'GRADIENT_RADIAL' || !paint.gradientTransform) return fallback;
  const [[sx, , tx], [, sy, ty]] = paint.gradientTransform;
  return {
    centreX: Math.round(((tx ?? 0) + 0.5 * (sx ?? 1)) * 100),
    centreY: Math.round(((ty ?? 0) + 0.5 * (sy ?? 1)) * 100),
    width: Math.round((sx ?? 1) * 100),
    height: Math.round((sy ?? 1) * 100),
  };
}

export function withRadialPlacement(paint: Paint, placement: Partial<RadialPlacement>): Paint {
  if (paint.type !== 'GRADIENT_RADIAL') return paint;
  const current = radialPlacement(paint);
  const next = { ...current, ...placement };
  const sx = next.width / 100;
  const sy = next.height / 100;
  const tx = next.centreX / 100 - 0.5 * sx;
  const ty = next.centreY / 100 - 0.5 * sy;
  return { ...paint, gradientTransform: [[sx, 0, tx], [0, sy, ty]] };
}


/**
 * The two ends of a linear gradient in normalized box space (0..1 on each axis). The
 * default gradient runs from the left edge's middle to the right edge's middle.
 */
export function gradientEnds(paint: Paint): { start: { x: number; y: number }; end: { x: number; y: number } } | null {
  if (paint.type !== 'GRADIENT_LINEAR') return null;
  const m = paint.gradientTransform ?? [[1, 0, 0], [0, 1, 0]];
  const at = (x: number, y: number) => ({
    x: (m[0]?.[0] ?? 1) * x + (m[0]?.[1] ?? 0) * y + (m[0]?.[2] ?? 0),
    y: (m[1]?.[0] ?? 0) * x + (m[1]?.[1] ?? 1) * y + (m[1]?.[2] ?? 0),
  });
  return { start: at(0, 0.5), end: at(1, 0.5) };
}

/** Move the gradient's ends to these normalized points; the direction is their difference. */
export function withGradientEnds(paint: Paint, start: { x: number; y: number }, end: { x: number; y: number }): Paint {
  if (paint.type !== 'GRADIENT_LINEAR') return paint;
  const a = end.x - start.x;
  const b = end.y - start.y;
  const c = -b;
  const d = a;
  return { ...paint, gradientTransform: [[a, c, start.x - c * 0.5], [b, d, start.y - d * 0.5]] };
}

/** The three handles of a radial gradient, in normalized box space: centre, right and bottom edges. */
export function radialHandles(paint: Paint): { centre: { x: number; y: number }; right: { x: number; y: number }; bottom: { x: number; y: number } } | null {
  if (paint.type !== 'GRADIENT_RADIAL') return null;
  const placement = radialPlacement(paint);
  const cx = placement.centreX / 100;
  const cy = placement.centreY / 100;
  return {
    centre: { x: cx, y: cy },
    right: { x: cx + placement.width / 200, y: cy },
    bottom: { x: cx, y: cy + placement.height / 200 },
  };
}

/**
 * Drag one radial handle: the centre moves the gradient, a side handle sets that axis's
 * radius (so the ellipse's full width or height is twice the distance to the edge).
 */
export function withRadialHandle(paint: Paint, which: 'centre' | 'right' | 'bottom', point: { x: number; y: number }): Paint {
  if (paint.type !== 'GRADIENT_RADIAL') return paint;
  const current = radialPlacement(paint);
  const centreX = which === 'centre' ? point.x * 100 : current.centreX;
  const centreY = which === 'centre' ? point.y * 100 : current.centreY;
  const width = which === 'right' ? Math.max(1, Math.abs(point.x * 100 - current.centreX) * 2) : current.width;
  const height = which === 'bottom' ? Math.max(1, Math.abs(point.y * 100 - current.centreY) * 2) : current.height;
  return withRadialPlacement(paint, { centreX: Math.round(centreX * 10) / 10, centreY: Math.round(centreY * 10) / 10, width: Math.round(width), height: Math.round(height) });
}
