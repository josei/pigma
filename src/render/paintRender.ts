import type { ColorStop, Paint } from '../model/types';
import { figmaColorToCss, type GradientSpec } from '../model/paint';

/** Shared paint -> SVG plumbing for the live renderer and the SVG exporter. */

export function gradientStopsToProps(stops: ColorStop[]) {
  return stops.map((stop) => ({
    offset: `${Math.round(Math.min(1, Math.max(0, stop.position)) * 100)}%`,
    stopColor: figmaColorToCss(stop.color, 1),
    stopOpacity: stop.color.a ?? 1,
  }));
}

/** Figma stores gradient transforms in normalized (object bounding box) space. */
export function gradientTransformAttr(spec: GradientSpec): string {
  const { a, b, c, d, tx, ty } = spec.matrix;
  return `matrix(${a} ${b} ${c} ${d} ${tx} ${ty})`;
}

/**
 * Angular and diamond gradients have no native SVG equivalent; they are
 * rasterized once through a 2D canvas and reused as an <image> fill.
 */
const rasterCache = new Map<string, string>();

export function rasterGradient(paint: Paint): string | null {
  if (paint.type !== 'GRADIENT_ANGULAR' && paint.type !== 'GRADIENT_DIAMOND') return null;
  const key = JSON.stringify(paint);
  const cached = rasterCache.get(key);
  if (cached) return cached;
  if (typeof document === 'undefined') return null;

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const stops = [...paint.gradientStops].sort((a, b) => a.position - b.position);
  const sample = (t: number): [number, number, number, number] => {
    const clamped = Math.min(1, Math.max(0, t));
    let previous = stops[0];
    let next = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i += 1) {
      const a = stops[i];
      const b = stops[i + 1];
      if (a && b && clamped >= a.position && clamped <= b.position) {
        previous = a;
        next = b;
        break;
      }
    }
    if (!previous || !next) return [0, 0, 0, 1];
    const span = next.position - previous.position;
    const t2 = span <= 0 ? 0 : (clamped - previous.position) / span;
    const pa = previous.color.a ?? 1;
    const na = next.color.a ?? 1;
    return [
      previous.color.r + (next.color.r - previous.color.r) * t2,
      previous.color.g + (next.color.g - previous.color.g) * t2,
      previous.color.b + (next.color.b - previous.color.b) * t2,
      pa + (na - pa) * t2,
    ];
  };

  if (paint.type === 'GRADIENT_ANGULAR' && 'createConicGradient' in ctx) {
    const gradient = ctx.createConicGradient(-Math.PI / 2, size / 2, size / 2);
    for (const stop of stops) gradient.addColorStop(stop.position, figmaColorToCss(stop.color, stop.color.a ?? 1));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  } else {
    const image = ctx.createImageData(size, size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const nx = (x + 0.5) / size - 0.5;
        const ny = (y + 0.5) / size - 0.5;
        // Diamond gradients follow the L1 norm; conic fallbacks use the angle.
        const t =
          paint.type === 'GRADIENT_DIAMOND'
            ? Math.min(1, Math.abs(nx) + Math.abs(ny)) * 2
            : (Math.atan2(ny, nx) + Math.PI / 2) / (Math.PI * 2);
        const [r, g, b, a] = sample(t);
        const index = (y * size + x) * 4;
        image.data[index] = Math.round(r * 255);
        image.data[index + 1] = Math.round(g * 255);
        image.data[index + 2] = Math.round(b * 255);
        image.data[index + 3] = Math.round(a * 255);
      }
    }
    ctx.putImageData(image, 0, 0);
  }

  const url = canvas.toDataURL('image/png');
  rasterCache.set(key, url);
  return url;
}

export interface PaintResolution {
  /** `url(#id)` when a gradient/image def is required, otherwise a color. */
  value: string;
  opacity: number;
}

const GRADIENT_TYPES: ReadonlySet<Paint['type']> = new Set([
  'GRADIENT_LINEAR',
  'GRADIENT_RADIAL',
  'GRADIENT_ANGULAR',
  'GRADIENT_DIAMOND',
]);

/**
 * Resolve a paint to an SVG paint value.
 *
 * Everything that is not a solid colour paints through a *referenced* paint
 * server (`url(#id)`) — a raster data URL is not a valid SVG paint, so images and
 * rasterised gradients must go through the `<pattern>` def the caller emits.
 * `resolvePaint` returning null means "paint nothing".
 */
export function resolvePaint(paint: Paint | null | undefined, defsId: string): PaintResolution | null {
  if (!paint || paint.visible === false) return null;
  const opacity = paint.opacity ?? 1;
  switch (paint.type) {
    case 'SOLID':
      return { value: figmaColorToCss(paint.color, 1), opacity };
    case 'IMAGE':
      return paint.dataUrl ? { value: `url(#${defsId})`, opacity } : null;
    case 'GRADIENT_LINEAR':
    case 'GRADIENT_RADIAL':
    case 'GRADIENT_ANGULAR':
    case 'GRADIENT_DIAMOND':
      return { value: `url(#${defsId})`, opacity };
    default:
      return null;
  }
}

/** True when the paint needs a `<defs>` entry the caller must emit. */
export function needsPaintServerDef(paint: Paint | null | undefined): boolean {
  if (!paint || paint.visible === false) return false;
  if (paint.type === 'IMAGE') return Boolean(paint.dataUrl);
  return GRADIENT_TYPES.has(paint.type);
}

