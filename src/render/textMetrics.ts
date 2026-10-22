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
  /**
   * Where each line's own characters sit in the text: `characters.slice(start, end)` is the line without any list
   * marker or wrap indent. Empty when the text was changed by case transform, so no offset can be trusted.
   */
  sources: Array<{ start: number; end: number }>;
  lineHeight: number;
  width: number;
  height: number;
}

/**
 * Lay text out inside `maxWidth`. `wrap` is on for fixed-width text
 * (textAutoResize HEIGHT/NONE/TRUNCATE) and off for auto-width text.
 */
/** A part of a line with its own weight, in the text's offsets (for per-range bold). */
export interface WeightRun {
  start: number;
  end: number;
  fontWeight: number;
}

/**
 * The width of text made of parts, each measured at its own weight. A part is plain text with an optional weight; the
 * parts are measured one by one and added, so a bold part is measured in the bold face.
 */
export function measureRuns(parts: Array<{ text: string; fontWeight?: number }>, style: TextStyle): number {
  return parts.reduce(
    (width, part) =>
      width + measureLine(part.text, part.fontWeight === undefined ? style : { ...style, fontWeight: part.fontWeight }),
    0,
  );
}

/**
 * The width of `text` placed at text offset `from`, with the weight runs that cover it. Characters outside every run are
 * measured at the layer's own style.
 */
function measureAt(text: string, from: number, style: TextStyle, runs: WeightRun[]): number {
  if (runs.length === 0) return measureLine(text, style);
  const parts: Array<{ text: string; fontWeight?: number }> = [];
  let cursor = 0;
  for (const run of runs) {
    const start = Math.max(run.start - from, 0);
    const end = Math.min(run.end - from, text.length);
    if (end <= start || end <= cursor) continue;
    if (start > cursor) parts.push({ text: text.slice(cursor, start) });
    parts.push({ text: text.slice(Math.max(start, cursor), end), fontWeight: run.fontWeight });
    cursor = end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return measureRuns(parts, style);
}

export function layoutText(
  characters: string,
  style: TextStyle,
  maxWidth?: number,
  wrap = false,
  runs: WeightRun[] = [],
): TextLayout {
  const transformed = textCaseTransform(characters, style);
  const lineHeight = resolveLineHeight(style);
  const lines: string[] = [];
  const sources: Array<{ start: number; end: number }> = [];
  const listed = style.listType === 'ORDERED' || style.listType === 'UNORDERED';

  // A list marks each non-empty paragraph; ordered lists count only those.
  let listIndex = 0;
  // Offset in `characters` where the current paragraph starts (paragraphs are joined by one '\n').
  let paragraphStart = 0;
  for (const paragraph of transformed.split('\n')) {
    const marker = !listed || paragraph === '' ? '' : style.listType === 'ORDERED' ? `${++listIndex}. ` : '• ';
    // Wrapped lines of a list item start under its text, not under the marker:
    // the indent is as wide as the marker, in non-breaking spaces so it survives.
    const indent = marker === '' ? '' : '\u00a0'.repeat(indentWidthOf(marker, style));
    if (!wrap || maxWidth === undefined || maxWidth <= 0) {
      lines.push(marker + paragraph);
      sources.push({ start: paragraphStart, end: paragraphStart + paragraph.length });
      paragraphStart += paragraph.length + 1;
      continue;
    }
    const words = paragraph.split(' ');
    let current = '';
    let currentStart = paragraphStart;
    // Offset of the next word: each word is followed by one space (or the paragraph break).
    let cursor = paragraphStart;
    let onFirstLine = true;
    for (const word of words) {
      const wordStart = cursor;
      cursor += word.length + 1;
      const candidate = current === '' ? word : `${current} ${word}`;
      const prefix = onFirstLine ? marker : indent;
      // Without weight runs the line is measured whole, as before. With runs, the marker or indent is measured plain
      // and the candidate at its own offset, so a bold word is measured in the bold face.
      const candidateWidth =
        runs.length === 0
          ? measureLine(prefix + candidate, style)
          : measureLine(prefix, style) + measureAt(candidate, current === '' ? wordStart : currentStart, style, runs);
      if (candidateWidth <= maxWidth || current === '') {
        if (current === '') currentStart = wordStart;
        current = candidate;
      } else {
        lines.push(prefix + current);
        sources.push({ start: currentStart, end: currentStart + current.length });
        current = word;
        currentStart = wordStart;
        onFirstLine = false;
      }
    }
    lines.push((onFirstLine ? marker : indent) + current);
    sources.push({ start: currentStart, end: currentStart + current.length });
    paragraphStart = cursor;
  }
  // A case transform can change the length, which would move every offset: then no offsets are offered.
  if (transformed.length !== characters.length) sources.length = 0;

  const width = wrap && maxWidth !== undefined ? maxWidth : Math.max(0, ...lines.map((line) => measureLine(line, style)));
  const spacing = style.paragraphSpacing ?? 0;
  return {
    lines,
    sources,
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
