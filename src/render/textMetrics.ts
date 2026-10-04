import type { TextStyle } from '../model/types';

/**
 * Text measurement used by both the on-canvas renderer and the JSON/SVG
 * exporters. Browsers give exact metrics through a 2D canvas context; outside a
 * DOM (unit tests, SSR) we fall back to deterministic per-character estimates so
 * layout stays stable and testable.
 */

let context: CanvasRenderingContext2D | null | undefined;

function measurementContext(): CanvasRenderingContext2D | null {
  if (context !== undefined) return context;
  if (typeof document === 'undefined') {
    context = null;
    return context;
  }
  const canvas = document.createElement('canvas');
  context = canvas.getContext('2d');
  return context;
}

const FALLBACK_ADVANCE = 0.52;

export function fontShorthand(style: TextStyle): string {
  const weight = style.fontWeight ?? (style.fontStyle?.includes('Bold') ? 700 : 400);
  return `${weight} ${style.fontSize}px ${style.fontFamily}, Inter, -apple-system, "Segoe UI", sans-serif`;
}

export function textCaseTransform(characters: string, style: TextStyle): string {
  switch (style.textCase) {
    case 'UPPER':
      return characters.toUpperCase();
    case 'LOWER':
      return characters.toLowerCase();
    case 'TITLE':
      return characters.replace(/\b\w/g, (c) => c.toUpperCase());
    default:
      return characters;
  }
}

/** Width of a single line in pixels, including letter spacing. */
export function measureLine(line: string, style: TextStyle): number {
  const spacing = style.letterSpacing?.unit === 'PIXELS' ? style.letterSpacing.value : 0;
  const percent = style.letterSpacing?.unit === 'PERCENT' ? style.letterSpacing.value / 100 : 0;
  const ctx = measurementContext();
  if (!ctx) {
    return line.length * style.fontSize * (FALLBACK_ADVANCE + percent);
  }
  ctx.font = fontShorthand(style);
  const base = ctx.measureText(line).width;
  const perChar = base * percent;
  return base + perChar * Math.max(0, line.length - 1) + spacing * Math.max(0, line.length - 1);
}

export function resolveLineHeight(style: TextStyle): number {
  const lineHeight = style.lineHeight;
  if (!lineHeight || lineHeight.unit === 'AUTO' || lineHeight.value === undefined) return style.fontSize * 1.2;
  if (lineHeight.unit === 'PIXELS') return lineHeight.value;
  return (style.fontSize * lineHeight.value) / 100;
}

/** Rough ascent used to position the first baseline (Figma top-aligns text). */
export function firstBaselineOffset(style: TextStyle): number {
  return resolveLineHeight(style) / 2 + style.fontSize * 0.36;
}

export interface TextLayout {
  lines: string[];
  lineHeight: number;
  width: number;
  height: number;
}

/**
 * Lay text out inside `maxWidth`. `wrap` is on for fixed-width text
 * (textAutoResize HEIGHT/NONE/TRUNCATE) and off for auto-width text.
 */
export function layoutText(characters: string, style: TextStyle, maxWidth?: number, wrap = false): TextLayout {
  const transformed = textCaseTransform(characters, style);
  const paragraphs = transformed.split('\n');
  const lineHeight = resolveLineHeight(style);
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    if (!wrap || maxWidth === undefined || maxWidth <= 0) {
      lines.push(paragraph);
      continue;
    }
    const words = paragraph.split(' ');
    let current = '';
    for (const word of words) {
      const candidate = current === '' ? word : `${current} ${word}`;
      if (measureLine(candidate, style) <= maxWidth || current === '') {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
    lines.push(current);
  }

  const width = wrap && maxWidth !== undefined ? maxWidth : Math.max(0, ...lines.map((line) => measureLine(line, style)));
  const spacing = style.paragraphSpacing ?? 0;
  return {
    lines,
    lineHeight,
    width,
    height: lines.length * lineHeight + Math.max(0, lines.length - 1) * spacing,
  };
}

/** Fonts load asynchronously; callers re-measure once this resolves. */
export function whenFontsReady(callback: () => void): void {
  if (typeof document === 'undefined' || !('fonts' in document)) return;
  void document.fonts.ready.then(callback);
}
