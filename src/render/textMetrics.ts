import type { TextNode, TextStyle } from '../model/types';

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
  const lineHeight = resolveLineHeight(style);
  const lines: string[] = [];
  const listed = style.listType === 'ORDERED' || style.listType === 'UNORDERED';

  // A list marks each non-empty paragraph; ordered lists count only those.
  let listIndex = 0;
  for (const paragraph of transformed.split('\n')) {
    const marker = !listed || paragraph === '' ? '' : style.listType === 'ORDERED' ? `${++listIndex}. ` : '• ';
    // Wrapped lines of a list item start under its text, not under the marker:
    // the indent is as wide as the marker, in non-breaking spaces so it survives.
    const indent = marker === '' ? '' : '\u00a0'.repeat(indentWidthOf(marker, style));
    if (!wrap || maxWidth === undefined || maxWidth <= 0) {
      lines.push(marker + paragraph);
      continue;
    }
    const words = paragraph.split(' ');
    let current = '';
    let onFirstLine = true;
    for (const word of words) {
      const candidate = current === '' ? word : `${current} ${word}`;
      const prefix = onFirstLine ? marker : indent;
      if (measureLine(prefix + candidate, style) <= maxWidth || current === '') {
        current = candidate;
      } else {
        lines.push(prefix + current);
        current = word;
        onFirstLine = false;
      }
    }
    lines.push((onFirstLine ? marker : indent) + current);
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

/** How many spaces wide a marker is, so a wrapped line can hang under the text. */
function indentWidthOf(marker: string, style: TextStyle): number {
  const space = measureLine(' ', style);
  if (space <= 0) return 0;
  return Math.max(1, Math.round(measureLine(marker, style) / space));
}

/** Fonts load asynchronously; callers re-measure once this resolves. */
export function whenFontsReady(callback: () => void): void {
  if (typeof document === 'undefined' || !('fonts' in document)) return;
  void document.fonts.ready.then(callback);
}

/** Visible text lines for a node, applying wrapping and truncation rules. */
export function textLinesOf(node: TextNode): string[] {
  const autoResize = node.style.textAutoResize ?? 'WIDTH_AND_HEIGHT';
  if (autoResize === 'TRUNCATE') return [truncate(node.characters, node.style, node.width)];
  const wrap = autoResize === 'HEIGHT' || autoResize === 'NONE';
  return layoutText(node.characters, node.style, node.width, wrap).lines;
}

function truncate(characters: string, style: TextNode['style'], maxWidth: number): string {
  const single = characters.replace(/\n/g, ' ');
  if (layoutText(single, style).width <= maxWidth) return single;
  let result = single;
  while (result.length > 1 && layoutText(`${result}…`, style).width > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result}…`;
}

/** Letter spacing in user units (percentages resolve against the font size). */
export function letterSpacingOf(style: TextStyle): number {
  const spacing = style.letterSpacing;
  if (!spacing) return 0;
  const value = spacing.unit === 'PERCENT' ? (spacing.value / 100) * style.fontSize : spacing.value;
  // Rounded so the SVG attribute (and the PDF Tc) never carry float noise.
  return Math.round(value * 1000) / 1000;
}
