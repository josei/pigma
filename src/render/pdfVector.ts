import type { PigmaFile, Paint, SceneNode, TextStyle, Transform } from '../model/types';
import { DEFAULT_MITER_LIMIT, hasChildren } from '../model/types';
import { fromMatrix, multiply, roundTo } from '../model/matrix';

import { cornerRadii, shapePath } from './SceneRenderer';
import { pathToPdf } from './pdfPath';
import { ARROW_HEAD_LENGTH, arrowheadPaths, isArrowCap } from '../model/arrowheads';
import { openPolylinesOf } from '../model/boolean';
import { layoutText, measureLine, measureParts } from './textMetrics';
import { letterSpacingOf, textLinesOf } from './textMetrics';
import { lineSegments, weightRunsOf } from '../model/textRanges';
import { resolveNodeVariables } from '../model/variables';
import { rasterGradient } from './paintRender';

/**
 * Vector PDF export (M16).
 *
 * Walks the scene with the very same geometry helpers the canvas uses
 * (`shapePath`, `cornerRadii`, `layoutText`) and emits PDF content-stream
 * operators: paths for shapes, shadings for linear/radial gradients, dash
 * patterns, alpha via ExtGState, and real text objects with a base-14 font.
 *
 * Everything the PDF format cannot express (bitmap fills, angular/diamond
 * gradients, shadows and blurs, non-base-14 typefaces) is reported in
 * `warnings` instead of being silently dropped, and gradients that cannot be
 * shaded fall back to a flat mid-stop colour so nothing disappears.
 */

export interface VectorPdfOptions {
  /** Page size in points. */
  width: number;
  height: number;
  /** Scene-space origin mapped to the page's top-left corner. */
  offsetX?: number;
  offsetY?: number;
  title?: string;
  background?: string;
}

export interface VectorPdfResult {
  bytes: Uint8Array;
  warnings: string[];
}

const encoder = new TextEncoder();

/** WinAnsi escapes for the few non-ASCII characters the editor produces. */
const WINANSI: Record<string, string> = {
  '…': '\\205',
  '‘': '\\221',
  '’': '\\222',
  '“': '\\223',
  '”': '\\224',
  '–': '\\226',
  '—': '\\227',
};

function pdfString(value: string): string {
  return value
    .replace(/[\\()]/g, (match) => `\\${match}`)
    .replace(/[^\x20-\x7e]/g, (character) => WINANSI[character] ?? '?');
}

const num = (value: number): string => {
  const rounded = roundTo(value, 3);
  return Number.isFinite(rounded) ? String(rounded) : '0';
};

/** A paint's colour as PDF `rg`/`RG` components (0..1). */
function colorOf(paint: Extract<Paint, { type: 'SOLID' }>): [number, number, number] {
  return [paint.color.r, paint.color.g, paint.color.b];
}

/** Average of a gradient's stops, used when no shading can be emitted. */
function midStop(paint: Paint & { gradientStops: Array<{ position: number; color: { r: number; g: number; b: number } }> }): [number, number, number] {
  if (paint.gradientStops.length === 0) return [0, 0, 0];
  const sorted = [...paint.gradientStops].sort((a, b) => a.position - b.position);
  const middle = sorted[Math.floor(sorted.length / 2)]!;
  return [middle.color.r, middle.color.g, middle.color.b];
}

/** Accepts `rgb()/rgba()` and `#rgb`/`#rrggbb`, the two forms the UI produces. */
function cssColorToRgb(value: string): [number, number, number] {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (hex) {
    const digits = hex[1]!.length === 3 ? hex[1]!.split('').map((c) => c + c).join('') : hex[1]!;
    return [
      Number.parseInt(digits.slice(0, 2), 16) / 255,
      Number.parseInt(digits.slice(2, 4), 16) / 255,
      Number.parseInt(digits.slice(4, 6), 16) / 255,
    ];
  }
  const match = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(value);
  if (!match) return [0, 0, 0];
  return [Number(match[1]) / 255, Number(match[2]) / 255, Number(match[3]) / 255];
}

interface PdfBuilder {
  content: string[];
  warnings: string[];
  shadings: string[];
  /** Optional `cm` operator per shading, from the paint's gradient transform. */
  shadingTransforms: Map<string, string>;
  /** Shading patterns for gradient strokes: the shading's index, and the matrix from its space to the page. */
  patterns: Array<{ shading: number; matrix: Transform }>;
  gstates: Map<string, number>;
  /** Set of features already reported, so warnings stay readable. */
  reported: Set<string>;
}

function warnOnce(builder: PdfBuilder, key: string, message: string): void {
  if (builder.reported.has(key)) return;
  builder.reported.add(key);
  builder.warnings.push(message);
}

function alphaName(builder: PdfBuilder, alpha: number): string {
  const key = alpha.toFixed(2);
  const existing = builder.gstates.get(key);
  if (existing !== undefined) return `GS${existing}`;
  const index = builder.gstates.size + 1;
  builder.gstates.set(key, index);
  return `GS${index}`;
}

/**
 * Geometry for the PDF: `shapePath` covers rounded rects, ellipses, stars and
 * vector/boolean paths, while plain rectangles and lines are drawn as dedicated
 * SVG elements on the canvas and need a path here.
 */
function pdfShapePath(node: SceneNode): string | null {
  const path = shapePath(node);
  if (path) return path;
  if (node.type === 'LINE') return `M 0 0 L ${num(node.width)} ${num(node.height)}`;
  const rectLike =
    node.type === 'RECTANGLE' ||
    node.type === 'FRAME' ||
    node.type === 'COMPONENT' ||
    node.type === 'COMPONENT_SET' ||
    node.type === 'INSTANCE' ||
    node.type === 'SECTION' ||
    node.type === 'GROUP';
  if (rectLike && (node.fills.length > 0 || node.strokes.length > 0)) {
    return `M 0 0 H ${num(node.width)} V ${num(node.height)} H 0 Z`;
  }
  return null;
}

/**
 * Paint one node's shape. `shadingIndex` is only used for gradient fills, which
 * need a clip so the shading covers just the shape.
 */
function paintShape(
  builder: PdfBuilder,
  node: SceneNode,
  paint: Paint,
  index: number,
  kind: 'fill' | 'stroke',
  matrix?: Transform,
): void {
  const path = pdfShapePath(node);
  if (!path) return;
  const pdfPath = pathToPdf(path);
  const alpha = paint.opacity ?? 1;
  if (alpha < 1) builder.content.push(`/${alphaName(builder, alpha)} gs`);

  if (paint.type === 'SOLID') {
    const [r, g, b] = colorOf(paint);
    builder.content.push(`${num(r)} ${num(g)} ${num(b)} ${kind === 'fill' ? 'rg' : 'RG'}`);
    builder.content.push(pdfPath);
    builder.content.push(kind === 'fill' ? 'f' : 'S');
    return;
  }

  if (paint.type === 'GRADIENT_LINEAR' || paint.type === 'GRADIENT_RADIAL') {
    const shading = shadingName(builder, paint, node, index, kind);
    if (!shading) {
      const [r, g, b] = midStop(paint);
      builder.content.push(`${num(r)} ${num(g)} ${num(b)} ${kind === 'fill' ? 'rg' : 'RG'}`);
      builder.content.push(pdfPath);
      builder.content.push(kind === 'fill' ? 'f' : 'S');
      return;
    }
    if (kind === 'fill') {
      // Clip to the shape so the shading only covers it, then paint with `sh`.
      builder.content.push('q');
      builder.content.push(pdfPath);
      builder.content.push('W n');
      // `sh` takes the shading name as a keyword: it needs the leading slash.
      const transform = builder.shadingTransforms.get(shading);
      if (transform) builder.content.push('q', transform);
      builder.content.push(`/${shading} sh`);
      if (transform) builder.content.push('Q');
      builder.content.push('Q');
    } else {
      // A gradient stroke takes a shading pattern, so the gradient is laid out in the node's own space, as a fill is.
      const pattern = matrix ? strokePatternName(builder, shading, matrix, paint, node) : null;
      if (pattern) {
        builder.content.push(`/Pattern CS /${pattern} SCN`);
        builder.content.push(pdfPath);
        builder.content.push('S');
      } else {
        warnOnce(builder, 'gradient-stroke', 'Gradient strokes are exported as a flat colour');
        const [r, g, b] = midStop(paint);
        builder.content.push(`${num(r)} ${num(g)} ${num(b)} RG`);
        builder.content.push(pdfPath);
        builder.content.push('S');
      }
    }
    return;
  }

  if (paint.type === 'IMAGE') {
    warnOnce(builder, 'image', 'Bitmap fills are not embedded in the vector PDF');
    return;
  }

  if (paint.type === 'GRADIENT_ANGULAR' || paint.type === 'GRADIENT_DIAMOND') {
    // These cannot be shaded by this writer: fall back to a flat mid-stop colour
    // so nothing disappears.
    warnOnce(builder, `gradient:${paint.type}`, `${paint.type} gradients are exported as a flat colour`);
    const [r, g, b] = midStop(paint);
    builder.content.push(`${num(r)} ${num(g)} ${num(b)} ${kind === 'fill' ? 'rg' : 'RG'}`);
    builder.content.push(pdfPath);
    builder.content.push(kind === 'fill' ? 'f' : 'S');
    return;
  }

  // `UnsupportedPaint` (VIDEO, PATTERN, and whatever Figma adds next) has no
  // shape a vector PDF can draw. It used to fall through to the gradient
  // fallback above and read `gradientStops` off undefined, crashing the whole
  // export; inexpressible content is reported, never fatal (see the module doc).
  warnOnce(builder, `unsupported:${paint.type}`, `${paint.type} fills are not exported to the vector PDF`);
}

/**
 * The arrowheads of an arrow cap, painted after the stroke: the arms as a stroke of the layer's weight, and the heads as a fill. Both
 * use the stroke paint's flat colour, which is the mid stop for a gradient, the same as the gradient fallback.
 */
function paintArrowheads(builder: PdfBuilder, node: SceneNode, paint: Paint, matrix: Transform): void {
  if (!isArrowCap(node.strokeCap)) return;
  const colour = arrowheadColour(builder, node, paint, matrix);
  if (!colour) return;
  const alpha = paint.opacity ?? 1;
  if (alpha < 1) builder.content.push(`/${alphaName(builder, alpha)} gs`);
  const { arms, heads } = arrowheadPaths(openPolylinesOf(node), node.strokeCap, node.strokeWeight ?? 1, node.arrowHeadLength ?? ARROW_HEAD_LENGTH);
  if (arms) {
    builder.content.push(colour.stroke);
    builder.content.push(pathToPdf(arms));
    builder.content.push('S');
  }
  if (heads) {
    builder.content.push(colour.fill);
    builder.content.push(pathToPdf(heads));
    builder.content.push('f');
  }
}

/**
 * The operators that colour an arrowhead's arms (stroke) and heads (fill). A solid stroke uses its colour; a linear or radial gradient
 * uses the same shading pattern as the stroke. Other gradients, and a gradient that cannot be shaded, use the mid stop.
 */
function arrowheadColour(builder: PdfBuilder, node: SceneNode, paint: Paint, matrix: Transform): { stroke: string; fill: string } | null {
  if (paint.type === 'SOLID') {
    const [r, g, b] = colorOf(paint);
    const rgb = `${num(r)} ${num(g)} ${num(b)}`;
    return { stroke: `${rgb} RG`, fill: `${rgb} rg` };
  }
  if (paint.type === 'GRADIENT_LINEAR' || paint.type === 'GRADIENT_RADIAL') {
    const shading = shadingName(builder, paint, node, 0, 'stroke');
    if (shading) {
      const pattern = strokePatternName(builder, shading, matrix, paint, node);
      return { stroke: `/Pattern CS /${pattern} SCN`, fill: `/Pattern cs /${pattern} scn` };
    }
  }
  if (paint.type.startsWith('GRADIENT')) {
    const [r, g, b] = midStop(paint as Parameters<typeof midStop>[0]);
    const rgb = `${num(r)} ${num(g)} ${num(b)}`;
    return { stroke: `${rgb} RG`, fill: `${rgb} rg` };
  }
  return null;
}

/** Register an axial (2) or radial (3) shading with its stops as a function. */
function shadingName(
  builder: PdfBuilder,
  paint: Paint,
  node: SceneNode,
  index: number,
  kind: 'fill' | 'stroke',
): string | null {
  if (paint.type !== 'GRADIENT_LINEAR' && paint.type !== 'GRADIENT_RADIAL') return null;
  if (rasterGradient(paint)) return null;
  const stops = [...paint.gradientStops].sort((a, b) => a.position - b.position);
  if (stops.length < 2) return null;
  const name = `Sh${builder.shadings.length + 1}`;
  // The shading is laid out in the box's unit square, as the canvas lays gradients out, and `unitToNode` scales it to the node. A
  // radial circle of radius 0.5 becomes the box's ellipse under that scale. The map is a `cm` around the shading, not /Matrix.
  const coordinates = paint.type === 'GRADIENT_LINEAR' ? '0 0 1 0' : '0.5 0.5 0 0.5 0.5 0.5';
  const toNode = unitToNode(node, paint);
  builder.shadingTransforms.set(
    name,
    `${num(toNode.a)} ${num(toNode.b)} ${num(toNode.c)} ${num(toNode.d)} ${num(toNode.tx)} ${num(toNode.ty)} cm`,
  );
  const functions = stops
    .map((stop, position) => {
      const next = stops[position + 1];
      if (!next) return null;
      const exponent = Math.max(0.0001, next.position - stop.position);
      const domain = `${num(stop.position)} ${num(next.position)}`;
      return `<< /FunctionType 2 /Domain [${domain}] /C0 [${num(stop.color.r)} ${num(stop.color.g)} ${num(stop.color.b)}] /C1 [${num(next.color.r)} ${num(next.color.g)} ${num(next.color.b)}] /N ${num(1 / exponent)} >>`;
    })
    .filter((entry): entry is string => entry !== null);
  if (functions.length === 0) return null;
  const functionRef = functions.length === 1 ? functions[0] : `[ ${functions.join(' ')} ]`;
  const type = paint.type === 'GRADIENT_LINEAR' ? 2 : 3;
  const extend = '[ true true ]';
  builder.shadings.push(
    `<< /ShadingType ${type} /ColorSpace /DeviceRGB /Coords [${coordinates}] /Function ${functionRef} /Extend ${extend} >>`,
  );
  void kind;
  void index;
  return name;
}

/**
 * A shading pattern for a gradient stroke. The shading was registered as for a fill, and the pattern maps its space to the page: the
 * gradient transform comes first and the node's own matrix second, as they do for a fill. Returns the pattern's name.
 */
function strokePatternName(builder: PdfBuilder, shading: string, matrix: Transform, paint: Paint, node: SceneNode): string {
  // The shading's name is `Sh` plus its place in the list, so its index is that number less one.
  builder.patterns.push({ shading: Number(shading.slice(2)) - 1, matrix: multiply(matrix, unitToNode(node, paint)) });
  return `P${builder.patterns.length}`;
}

/**
 * The map from a gradient's unit square to the node's own space. Figma stores a gradient transform in the box's unit square, which
 * the canvas applies there; so the shading is taken in that square and scaled to the box. A linear gradient runs from (0, 0) to (1, 0),
 * and a radial one is a circle of radius 0.5 about (0.5, 0.5), which the scale turns into the box's ellipse.
 */
function unitToNode(node: SceneNode, paint: Paint): Transform {
  const scale: Transform = { a: Math.max(node.width, 0.0001), b: 0, c: 0, d: Math.max(node.height, 0.0001), tx: 0, ty: 0 };
  const transform = paint.type === 'GRADIENT_LINEAR' || paint.type === 'GRADIENT_RADIAL' ? paint.gradientTransform : undefined;
  return transform ? multiply(scale, fromMatrix(transform)) : scale;
}

/** The link colour as PDF components: the same blue the canvas and SVG use (#0070c4). */
const LINK_RGB: [number, number, number] = [0, 0x70 / 255, 0xc4 / 255];

/** The base-14 face for a weight and style: bold from 700, italic in its own face, and bold italic in the bold-oblique one. */
function faceFor(weight: number, italic: boolean): 'F1' | 'F2' | 'F3' | 'F4' {
  if (italic) return weight >= 700 ? 'F4' : 'F3';
  return weight >= 700 ? 'F2' : 'F1';
}

function paintText(builder: PdfBuilder, node: Extract<SceneNode, { type: 'TEXT' }>): void {
  const autoResize = node.style.textAutoResize ?? 'WIDTH_AND_HEIGHT';
  // HEIGHT/NONE wrap to the node width, TRUNCATE clips to one line, like the canvas.
  const lines = textLinesOf(node);
  const layout = layoutText(node.characters, node.style, node.width, autoResize === 'HEIGHT' || autoResize === 'NONE', weightRunsOf(node.textRanges ?? []));
  const style: TextStyle = node.style;
  const size = style.fontSize || 12;
  const weight = style.fontWeight ?? (style.fontStyle?.includes('Bold') ? 700 : 400);
  const italic = style.fontStyle?.toLowerCase().includes('italic') ?? false;
  // Bold and italic use their own base-14 faces rather than a fake-bold hack.
  const font = faceFor(weight, italic);
  if (style.fontFamily && !/^(helvetica|arial|sans-serif)$/i.test(style.fontFamily)) {
    warnOnce(builder, 'font', `Text falls back to Helvetica (${style.fontFamily} is not embedded)`);
  }
  const fill = node.fills.find((paint) => paint.visible !== false);
  const [r, g, b] = fill && fill.type === 'SOLID' ? colorOf(fill) : [0, 0, 0];
  const alpha = fill?.opacity ?? 1;
  const spacing = letterSpacingOf(style);
  const decoration = style.textDecoration ?? 'NONE';
  const align = style.textAlignHorizontal ?? 'LEFT';
  const x = align === 'CENTER' ? node.width / 2 : align === 'RIGHT' ? node.width : 0;
  const lineHeight = layout.lineHeight;
  const vertical = style.textAlignVertical ?? 'TOP';
  const offsetY =
    vertical === 'CENTER'
      ? (node.height - layout.height) / 2
      : vertical === 'BOTTOM'
        ? node.height - layout.height
        : 0;

  if (alpha < 1) builder.content.push(`/${alphaName(builder, alpha)} gs`);
  builder.content.push(`${num(r)} ${num(g)} ${num(b)} rg`);
  // The page is flipped so scene y grows downwards; counter-flip inside the text
  // block, which leaves an upright text matrix (glyphs upright, and the text is
  // readable for extractors).
  builder.content.push('q');
  builder.content.push('1 0 0 -1 0 0 cm');
  builder.content.push('BT');
  builder.content.push(`/${font} ${num(size)} Tf`);
  lines.forEach((line, index) => {
    if (line === '') return;
    // PDF's text matrix origin is the baseline: shift down by the ascent.
    const baseline = offsetY + index * lineHeight + size * 0.8;
    const textY = baseline - node.height;
    // A line with linked characters is drawn in pieces, each at its own offset, the linked ones in the link colour.
    const source = autoResize === 'TRUNCATE' ? undefined : layout.sources[index];
    const segments = lineSegments(line, source, node.textRanges ?? []);
    if (segments.some((segment) => segment.link !== undefined || segment.fontWeight !== undefined)) {
      const width = measureParts(segments, style);
      const lineStart = align === 'CENTER' ? x - width / 2 : align === 'RIGHT' ? x - width : x;
      for (const [part, segment] of segments.entries()) {
        const segmentX = lineStart + measureParts(segments.slice(0, part), style);
        const [cr, cg, cb] = segment.link === undefined ? [r, g, b] : LINK_RGB;
        const face = segment.fontWeight === undefined ? font : faceFor(segment.fontWeight, italic);
        builder.content.push(`${num(cr)} ${num(cg)} ${num(cb)} rg`);
        builder.content.push(`/${face} ${num(size)} Tf`);
        builder.content.push(`${num(spacing)} Tc`);
        builder.content.push(`1 0 0 1 ${num(segmentX)} ${num(textY)} Tm`);
        builder.content.push(`(${pdfString(segment.text)}) Tj`);
        if (segment.link !== undefined) {
          // A link is underlined, like the canvas draws it.
          const segmentWidth = measureParts([segment], style);
          const ruleY = textY - size * 0.12;
          builder.content.push('ET');
          builder.content.push(`0.5 w ${num(segmentX)} ${num(ruleY)} m ${num(segmentX + segmentWidth)} ${num(ruleY)} l S`);
          builder.content.push('BT');
          builder.content.push(`/${face} ${num(size)} Tf`);
        }
      }
      builder.content.push(`/${font} ${num(size)} Tf`);
      builder.content.push(`${num(r)} ${num(g)} ${num(b)} rg`);
      if (decoration !== 'NONE') {
        const ruleY = decoration === 'UNDERLINE' ? textY - size * 0.12 : textY + size * 0.28;
        const startX = lineStart;
        builder.content.push('ET');
        builder.content.push(`0.5 w ${num(startX)} ${num(ruleY)} m ${num(startX + width)} ${num(ruleY)} l S`);
        if (index < lines.length - 1) {
          builder.content.push('BT');
          builder.content.push(`/${font} ${num(size)} Tf`);
        }
      }
      return;
    }
    builder.content.push(`${num(spacing)} Tc`);
    builder.content.push(`1 0 0 1 ${num(x)} ${num(textY)} Tm`);
    builder.content.push(`(${pdfString(line)}) Tj`);
    if (decoration !== 'NONE') {
      // Underline/line-through as a rule in the counter-flipped text space.
      const width = measureLine(line, style);
      const ruleY = decoration === 'UNDERLINE' ? textY - size * 0.12 : textY + size * 0.28;
      const startX = align === 'CENTER' ? x - width / 2 : align === 'RIGHT' ? x - width : x;
      builder.content.push('ET');
      builder.content.push(`0.5 w ${num(startX)} ${num(ruleY)} m ${num(startX + width)} ${num(ruleY)} l S`);
      if (index < lines.length - 1) {
        builder.content.push('BT');
        builder.content.push(`/${font} ${num(size)} Tf`);
      }
    }
  });
  builder.content.push('ET');
  builder.content.push('Q');
}

function strokeExtras(builder: PdfBuilder, node: SceneNode): void {
  const weight = node.strokeWeight ?? 1;
  builder.content.push(`${num(weight)} w`);
  builder.content.push(node.strokeCap === 'ROUND' ? '1 J' : node.strokeCap === 'SQUARE' ? '2 J' : '0 J');
  builder.content.push(node.strokeJoin === 'ROUND' ? '1 j' : node.strokeJoin === 'BEVEL' ? '2 j' : '0 j');
  builder.content.push(`${num(node.strokeMiterLimit ?? DEFAULT_MITER_LIMIT)} M`);
  if (node.dashPattern && node.dashPattern.length > 0) {
    builder.content.push(`[${node.dashPattern.map((value) => num(value * weight)).join(' ')}] ${num((node.dashOffset ?? 0) * weight)} d`);
  } else {
    builder.content.push('[] 0 d');
  }
}

function paintNode(builder: PdfBuilder, file: PigmaFile, node: SceneNode, parentMatrix: Transform): void {
  const resolved = resolveNodeVariables(file, node);
  const target = (resolved ? { ...node, ...resolved } : node) as SceneNode;
  if (!target.visible || target.opacity <= 0) return;
  const matrix = multiply(parentMatrix, target.transform);

  const children = hasChildren(target) ? (target.children as SceneNode[]) : [];
  const path = pdfShapePath(target);

  if (path || target.type === 'TEXT') {
    builder.content.push('q');
    builder.content.push(
      `${num(matrix.a)} ${num(matrix.b)} ${num(matrix.c)} ${num(matrix.d)} ${num(matrix.tx)} ${num(matrix.ty)} cm`,
    );
    if (target.opacity < 1) builder.content.push(`/${alphaName(builder, target.opacity)} gs`);

    if (target.type === 'TEXT') {
      paintText(builder, target as Extract<SceneNode, { type: 'TEXT' }>);
    } else {
      const winding = target.type === 'VECTOR' || target.type === 'BOOLEAN_OPERATION' ? (target.windingRule ?? 'NONZERO') : 'NONZERO';
      const fillOperator = winding === 'EVENODD' ? 'f*' : 'f';
      target.fills.forEach((paint, index) => {
        if (paint.visible === false) return;
        const before = builder.content.length;
        paintShape(builder, target, paint, index, 'fill');
        if (builder.content.length > before && fillOperator === 'f*') {
          // The paint helper emitted a plain `f`; upgrade to even-odd when needed.
          const last = builder.content[builder.content.length - 1];
          if (last === 'f') builder.content[builder.content.length - 1] = 'f*';
        }
      });
      const stroke = target.strokes.find((paint) => paint.visible !== false);
      if (stroke && (target.strokeWeight ?? 1) > 0) {
        strokeExtras(builder, target);
        paintShape(builder, target, stroke, 0, 'stroke', matrix);
        paintArrowheads(builder, target, stroke, matrix);
      }
    }
    builder.content.push('Q');
  }

  for (const child of children) paintNode(builder, file, child, matrix);

  if ((target.effects ?? []).some((effect) => effect.visible !== false)) {
    warnOnce(builder, 'effects', 'Shadows and blurs are not represented in the vector PDF');
  }
  if (cornerRadii(target).some((radius) => radius > 0) && !path && target.type !== 'TEXT') {
    warnOnce(builder, 'corners', 'Rounded corners need a path and were skipped on some layers');
  }
}

/** Render the given nodes to a single-page vector PDF. */
export function renderVectorPdf(file: PigmaFile, nodes: SceneNode[], options: VectorPdfOptions): VectorPdfResult {
  const builder: PdfBuilder = {
    content: [],
    warnings: [],
    shadings: [],
    shadingTransforms: new Map(),
    patterns: [],
    gstates: new Map(),
    reported: new Set(),
  };
  const offsetX = options.offsetX ?? 0;
  const offsetY = options.offsetY ?? 0;
  // Scene y grows downwards, PDF y grows upwards.
  builder.content.push('q');
  builder.content.push(`1 0 0 -1 ${num(-offsetX)} ${num(options.height + offsetY)} cm`);
  if (options.background) {
    const [r, g, b] = cssColorToRgb(options.background);
    builder.content.push(`${num(r)} ${num(g)} ${num(b)} rg 0 0 ${num(options.width)} ${num(options.height)} re f`);
  }
  for (const node of nodes) {
    paintNode(builder, file, node, { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
  }
  builder.content.push('Q');

  return { bytes: assemblePdf(builder, options), warnings: builder.warnings };
}

/** Assemble the PDF document around the collected content. */
function assemblePdf(builder: PdfBuilder, options: VectorPdfOptions): Uint8Array {
  const contentBytes = encoder.encode(builder.content.join('\n'));
  const objects: Array<{ head: string; stream?: Uint8Array }> = [];
  const shadingIds = builder.shadings.map((_, index) => 9 + index);
  // Pattern objects follow the shadings, in the same numbering.
  const patternIds = builder.patterns.map((_, index) => 9 + builder.shadings.length + index);

  const resources = [
    // Objects 5 to 8 are the four base-14 faces registered below.
    '/Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R /F4 8 0 R >>',
    builder.gstates.size > 0
      ? `/ExtGState << ${[...builder.gstates.entries()].map(([alpha, index]) => `/GS${index} << /ca ${alpha} /CA ${alpha} >>`).join(' ')} >>`
      : '',
    builder.shadings.length > 0
      ? `/Shading << ${builder.shadings.map((_, index) => `/Sh${index + 1} ${shadingIds[index]} 0 R`).join(' ')} >>`
      : '',
    builder.patterns.length > 0
      ? `/Pattern << ${builder.patterns.map((_, index) => `/P${index + 1} ${patternIds[index]} 0 R`).join(' ')} >>`
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  objects.push({ head: '<< /Type /Catalog /Pages 2 0 R >>' });
  objects.push({ head: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' });
  objects.push({
    head: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(options.width)} ${num(options.height)}] /Resources << ${resources} >> /Contents 4 0 R >>`,
  });
  objects.push({ head: `<< /Length ${contentBytes.length} >>\nstream\n`, stream: contentBytes });
  objects.push({ head: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>' });
  objects.push({
    head: `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`,
  });
  objects.push({ head: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>' });
  objects.push({ head: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-BoldOblique /Encoding /WinAnsiEncoding >>' });
  for (const shading of builder.shadings) objects.push({ head: shading });
  for (const pattern of builder.patterns) {
    const m = pattern.matrix;
    objects.push({
      head: `<< /Type /Pattern /PatternType 2 /Shading ${shadingIds[pattern.shading]} 0 R /Matrix [${num(m.a)} ${num(m.b)} ${num(m.c)} ${num(m.d)} ${num(m.tx)} ${num(m.ty)}] >>`,
    });
  }
  if (options.title) {
    objects.push({ head: `<< /Title (${pdfString(options.title)}) /Producer (Pigma) >>` });
  }

  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (data: Uint8Array | string) => {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };

  push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  objects.forEach((object, index) => {
    offsets.push(length);
    push(`${index + 1} 0 obj\n${object.head}`);
    if (object.stream) {
      push(object.stream);
      push('\nendstream');
    }
    push('\nendobj\n');
  });

  const xrefOffset = length;
  const count = objects.length + 1;
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (const offset of offsets) xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  const bytes = new Uint8Array(length);
  let position = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, position);
    position += chunk.length;
  }
  return bytes;
}

/** True when the bytes look like a PDF (used by tests and the export guard). */
export function isPdf(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}
