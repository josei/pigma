/**
 * Field mappers from Figma source shapes (REST JSON and native `.fig` decoded
 * nodes) onto the Pigma model's paint / effect / text / layout types.
 *
 * Every mapping that cannot be represented is reported through the
 * {@link ReportBuilder} rather than silently dropped. Fields that are merely
 * *renamed* (e.g. native `stackMode` → model `layoutMode`) are mapped directly;
 * the original object still lives on `node.raw`.
 */
import type {
  AutoLayout,
  BlendMode,
  Constraints,
  ConstraintType,
  Effect,
  GradientPaint,
  Paint,
  PrototypeAction,
  PrototypeInteraction,
  RGBA,
  ShadowEffect,
  SolidPaint,
  StrokeAlign,
  StrokeCap,
  StrokeJoin,
  TextStyle,
  Transform,
  TransformMatrix,
  UnsupportedEffect,
  UnsupportedPaint,
} from '../../model/types';
import { invert, toMatrix } from '../../model/matrix';
import { bytesToDataUrl, bytesToHex } from '../internal/base64';
import type { FigColor, FigEffect, FigNode, FigPaint } from '../native/parse';
import type { FigmaEffect, FigmaPaint, FigmaRestNode, FigmaTypeStyle } from '../rest/types';
import type { ReportBuilder } from './report';

export interface MapperContext {
  report: ReportBuilder;
  nodeId: string;
  path: string;
  /** Native archives embed image bytes keyed by content hash. */
  images?: Map<string, Uint8Array>;
}

const BLEND_MODES: Record<string, BlendMode> = {
  PASS_THROUGH: 'PASS_THROUGH',
  NORMAL: 'NORMAL',
  DARKEN: 'DARKEN',
  MULTIPLY: 'MULTIPLY',
  LINEAR_BURN: 'DARKEN',
  COLOR_BURN: 'COLOR_BURN',
  LIGHTEN: 'LIGHTEN',
  SCREEN: 'SCREEN',
  LINEAR_DODGE: 'LIGHTEN',
  COLOR_DODGE: 'COLOR_DODGE',
  OVERLAY: 'OVERLAY',
  SOFT_LIGHT: 'SOFT_LIGHT',
  HARD_LIGHT: 'HARD_LIGHT',
  DIFFERENCE: 'DIFFERENCE',
  EXCLUSION: 'EXCLUSION',
  HUE: 'HUE',
  SATURATION: 'SATURATION',
  COLOR: 'COLOR',
  LUMINOSITY: 'LUMINOSITY',
};

function blendMode(value: unknown, ctx: MapperContext, feature: string): BlendMode | undefined {
  if (typeof value !== 'string') return undefined;
  const mapped = BLEND_MODES[value];
  if (!mapped) {
    ctx.report.addUnsupported({ nodeId: ctx.nodeId, path: ctx.path, feature: `${feature}:blendMode:${value}` });
    return undefined;
  }
  return mapped;
}

function rgba(color: FigColor | undefined, fallbackAlpha = 1): RGBA {
  if (!color) return { r: 0, g: 0, b: 0, a: fallbackAlpha };
  return { r: color.r, g: color.g, b: color.b, a: color.a ?? fallbackAlpha };
}

function scaleMode(value: unknown): 'FILL' | 'FIT' | 'CROP' | 'TILE' | undefined {
  if (value === 'FILL' || value === 'FIT' || value === 'CROP' || value === 'TILE') return value;
  if (value === 'STRETCH') return 'FILL';
  return undefined;
}

// ─── REST paints ────────────────────────────────────────────────────────────

/**
 * Convert Figma's three gradient handles into the renderer-facing matrix.
 *
 * `gradientHandlePositions` are points in normalized object space: the start
 * (gradient coordinate 0,0.5), the end (1,0.5), and the width handle (0,1).
 * The model's `gradientTransform` is consumed directly as an SVG
 * `gradientTransform`, i.e. it maps gradient space → object space, so it is the
 * matrix whose columns are the handle basis vectors — no inversion.
 */
function gradientTransformFromHandles(handles: FigmaPaint['gradientHandlePositions']): TransformMatrix | undefined {
  if (!Array.isArray(handles) || handles.length < 3) return undefined;
  const h0 = handles[0];
  const h1 = handles[1];
  const h2 = handles[2];
  if (!h0 || !h1 || !h2) return undefined;
  const matrix: Transform = {
    a: h1.x - h0.x,
    b: h1.y - h0.y,
    c: 2 * (h2.x - h0.x),
    d: 2 * (h2.y - h0.y),
    tx: 2 * h0.x - h2.x,
    ty: 2 * h0.y - h2.y,
  };
  const det = matrix.a * matrix.d - matrix.b * matrix.c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return undefined;
  return toMatrix(matrix);
}

function restGradient(paint: FigmaPaint, type: GradientPaint['type'], ctx: MapperContext): GradientPaint {
  const stops = Array.isArray(paint.gradientStops) ? paint.gradientStops : [];
  if (stops.length === 0) {
    ctx.report.addUnsupported({ nodeId: ctx.nodeId, path: ctx.path, feature: 'paint:gradient:noStops' });
  }
  const mapped: GradientPaint = {
    type,
    gradientStops: stops.map((stop) => ({ position: stop.position, color: rgba(stop.color) })),
  };
  if (paint.gradientTransform) {
    mapped.gradientTransform = paint.gradientTransform;
  } else {
    const fromHandles = gradientTransformFromHandles(paint.gradientHandlePositions);
    if (fromHandles) {
      mapped.gradientTransform = fromHandles;
    } else {
      ctx.report.addUnsupported({
        nodeId: ctx.nodeId,
        path: ctx.path,
        feature: 'paint:gradient:noTransform',
        detail: 'no gradientTransform and no usable gradientHandlePositions; orientation defaults to identity',
      });
    }
  }
  if (paint.opacity !== undefined) mapped.opacity = paint.opacity;
  if (paint.visible !== undefined) mapped.visible = paint.visible;
  const mode = blendMode(paint.blendMode, ctx, 'paint');
  if (mode) mapped.blendMode = mode;
  return mapped;
}

export function mapRestPaint(paint: FigmaPaint, ctx: MapperContext): Paint {
  switch (paint.type) {
    case 'SOLID': {
      const solid: SolidPaint = { type: 'SOLID', color: { r: rgba(paint.color).r, g: rgba(paint.color).g, b: rgba(paint.color).b } };
      if (paint.opacity !== undefined) solid.opacity = paint.opacity;
      if (paint.visible !== undefined) solid.visible = paint.visible;
      const mode = blendMode(paint.blendMode, ctx, 'paint');
      if (mode) solid.blendMode = mode;
      if (paint.boundVariables) solid.boundVariables = paint.boundVariables;
      return solid;
    }
    case 'GRADIENT_LINEAR':
    case 'GRADIENT_RADIAL':
    case 'GRADIENT_ANGULAR':
    case 'GRADIENT_DIAMOND':
      return restGradient(paint, paint.type, ctx);
    case 'IMAGE': {
      const image: Paint = {
        type: 'IMAGE',
        imageRef: typeof paint.imageRef === 'string' ? paint.imageRef : undefined,
        scaleMode: scaleMode(paint.scaleMode),
        imageTransform: paint.imageTransform,
        scalingFactor: paint.scalingFactor,
        opacity: paint.opacity,
        visible: paint.visible,
      };
      const mode = blendMode(paint.blendMode, ctx, 'paint');
      if (mode) image.blendMode = mode;
      return image;
    }
    default: {
      ctx.report.addUnsupported({
        nodeId: ctx.nodeId,
        path: ctx.path,
        feature: `paint:${paint.type}`,
        detail: 'paint type has no Pigma representation; original retained in node.raw',
      });
      const unsupported: UnsupportedPaint = { type: paint.type as UnsupportedPaint['type'] };
      if (paint.opacity !== undefined) unsupported.opacity = paint.opacity;
      if (paint.visible !== undefined) unsupported.visible = paint.visible;
      const mode = blendMode(paint.blendMode, ctx, 'paint');
      if (mode) unsupported.blendMode = mode;
      return unsupported;
    }
  }
}

export function mapRestPaints(paints: FigmaPaint[] | undefined, ctx: MapperContext): Paint[] {
  if (!Array.isArray(paints)) return [];
  return paints.map((paint) => mapRestPaint(paint, ctx));
}

// ─── Native paints ──────────────────────────────────────────────────────────

export function mapNativePaint(paint: FigPaint, ctx: MapperContext): Paint {
  switch (paint.type) {
    case 'SOLID': {
      const solid: SolidPaint = { type: 'SOLID', color: { r: rgba(paint.color).r, g: rgba(paint.color).g, b: rgba(paint.color).b } };
      if (paint.opacity !== undefined) solid.opacity = paint.opacity;
      if (paint.visible !== undefined) solid.visible = paint.visible;
      const mode = blendMode(paint.blendMode, ctx, 'paint');
      if (mode) solid.blendMode = mode;
      return solid;
    }
    case 'GRADIENT_LINEAR':
    case 'GRADIENT_RADIAL':
    case 'GRADIENT_ANGULAR':
    case 'GRADIENT_DIAMOND': {
      const stops = Array.isArray(paint.stops) ? paint.stops : [];
      if (stops.length === 0) {
        ctx.report.addUnsupported({ nodeId: ctx.nodeId, path: ctx.path, feature: 'paint:gradient:noStops' });
      }
      const gradient: GradientPaint = {
        type: paint.type,
        gradientStops: stops.map((stop) => ({ position: stop.position ?? 0, color: rgba(stop.color) })),
      };
      if (paint.transform) {
        // Figma stores the paint transform as node space → gradient space;
        // the renderer consumes gradient space → object space (SVG semantics),
        // so the inverse is what must reach `gradientTransform`.
        const matrix: Transform = {
          a: paint.transform.m00,
          b: paint.transform.m10,
          c: paint.transform.m01,
          d: paint.transform.m11,
          tx: paint.transform.m02,
          ty: paint.transform.m12,
        };
        const det = matrix.a * matrix.d - matrix.b * matrix.c;
        if (Number.isFinite(det) && Math.abs(det) >= 1e-12) {
          gradient.gradientTransform = toMatrix(invert(matrix));
        } else {
          ctx.report.addUnsupported({ nodeId: ctx.nodeId, path: ctx.path, feature: 'paint:gradient:degenerateTransform' });
        }
      }
      if (paint.opacity !== undefined) gradient.opacity = paint.opacity;
      if (paint.visible !== undefined) gradient.visible = paint.visible;
      const mode = blendMode(paint.blendMode, ctx, 'paint');
      if (mode) gradient.blendMode = mode;
      return gradient;
    }
    case 'IMAGE': {
      const hash = bytesToHex(paint.image?.hash) ?? paint.imageRef;
      const bytes = hash ? ctx.images?.get(hash) : undefined;
      const image: Paint = {
        type: 'IMAGE',
        imageRef: hash,
        dataUrl: bytes ? bytesToDataUrl(bytes) : undefined,
        scaleMode: scaleMode(paint.scaleMode),
        scalingFactor: typeof paint.scalingFactor === 'number' ? paint.scalingFactor : undefined,
        opacity: paint.opacity,
        visible: paint.visible,
      };
      if (paint.transform) {
        image.imageTransform = [
          [paint.transform.m00, paint.transform.m01, paint.transform.m02],
          [paint.transform.m10, paint.transform.m11, paint.transform.m12],
        ];
      }
      const mode = blendMode(paint.blendMode, ctx, 'paint');
      if (mode) image.blendMode = mode;
      return image;
    }
    default: {
      ctx.report.addUnsupported({
        nodeId: ctx.nodeId,
        path: ctx.path,
        feature: `paint:${paint.type ?? 'unknown'}`,
        detail: 'paint type has no Pigma representation; original retained in node.raw',
      });
      const unsupported: UnsupportedPaint = { type: (paint.type ?? 'SOLID') as UnsupportedPaint['type'] };
      if (paint.opacity !== undefined) unsupported.opacity = paint.opacity;
      if (paint.visible !== undefined) unsupported.visible = paint.visible;
      const mode = blendMode(paint.blendMode, ctx, 'paint');
      if (mode) unsupported.blendMode = mode;
      return unsupported;
    }
  }
}

export function mapNativePaints(paints: FigPaint[] | undefined, ctx: MapperContext): Paint[] {
  if (!Array.isArray(paints)) return [];
  return paints.map((paint) => mapNativePaint(paint, ctx));
}

// ─── Effects ────────────────────────────────────────────────────────────────

const SHADOW_TYPES: Record<string, ShadowEffect['type']> = { DROP_SHADOW: 'DROP_SHADOW', INNER_SHADOW: 'INNER_SHADOW' };
const BLUR_TYPES: Record<string, 'LAYER_BLUR' | 'BACKGROUND_BLUR'> = {
  LAYER_BLUR: 'LAYER_BLUR',
  BACKGROUND_BLUR: 'BACKGROUND_BLUR',
  FOREGROUND_BLUR: 'LAYER_BLUR',
};

function mapEffect(effect: FigmaEffect | FigEffect, ctx: MapperContext): Effect {
  const type = typeof effect.type === 'string' ? effect.type : 'UNKNOWN';
  const shadow = SHADOW_TYPES[type];
  if (shadow) {
    const mapped: ShadowEffect = {
      type: shadow,
      color: rgba(effect.color as FigColor | undefined, 1),
      offset: { x: effect.offset?.x ?? 0, y: effect.offset?.y ?? 0 },
      radius: effect.radius ?? 0,
      spread: effect.spread,
      visible: effect.visible,
    };
    const mode = blendMode(effect.blendMode, ctx, 'effect');
    if (mode) mapped.blendMode = mode;
    if (typeof (effect as FigmaEffect).showShadowBehindNode === 'boolean') {
      mapped.showShadowBehindNode = (effect as FigmaEffect).showShadowBehindNode;
    }
    return mapped;
  }
  const blur = BLUR_TYPES[type];
  if (blur) {
    return { type: blur, radius: effect.radius ?? 0, visible: effect.visible };
  }
  ctx.report.addUnsupported({
    nodeId: ctx.nodeId,
    path: ctx.path,
    feature: `effect:${type}`,
    detail: 'effect type has no Pigma representation; original retained in node.raw',
  });
  return { type: type as UnsupportedEffect['type'], visible: effect.visible, ...effect } as UnsupportedEffect;
}

export function mapEffects(effects: Array<FigmaEffect | FigEffect> | undefined, ctx: MapperContext): Effect[] {
  if (!Array.isArray(effects)) return [];
  return effects.map((effect) => mapEffect(effect, ctx));
}

// ─── Constraints ────────────────────────────────────────────────────────────

const VERTICAL: Record<string, ConstraintType> = {
  TOP: 'MIN',
  BOTTOM: 'MAX',
  CENTER: 'CENTER',
  TOP_BOTTOM: 'STRETCH',
  SCALE: 'SCALE',
  MIN: 'MIN',
  MAX: 'MAX',
  STRETCH: 'STRETCH',
};
const HORIZONTAL: Record<string, ConstraintType> = {
  LEFT: 'MIN',
  RIGHT: 'MAX',
  CENTER: 'CENTER',
  LEFT_RIGHT: 'STRETCH',
  SCALE: 'SCALE',
  MIN: 'MIN',
  MAX: 'MAX',
  STRETCH: 'STRETCH',
};

export function mapRestConstraints(node: FigmaRestNode): Constraints | undefined {
  const constraints = node.constraints;
  if (!constraints) return undefined;
  const vertical = VERTICAL[constraints.vertical];
  const horizontal = HORIZONTAL[constraints.horizontal];
  if (!vertical || !horizontal) return undefined;
  return { vertical, horizontal };
}

/**
 * Constraints, in the NATIVE vocabulary.
 *
 * `VERTICAL`/`HORIZONTAL` list the native `ConstraintType` members — including
 * `SCALE`. `FIXED_MIN` and `FIXED_MAX` are native members the MODEL CANNOT
 * EXPRESS (`ConstraintType` is MIN/CENTER/MAX/STRETCH/SCALE), so they are
 * deliberately unmapped: coercing them into MIN/MAX would be silently wrong, and
 * an unmapped value leaves the constraint absent instead of inventing one. That
 * is a MODEL GAP to report, not a mapping to guess.
 */
export function mapNativeConstraints(node: FigNode): Constraints | undefined {
  const vertical = typeof node.verticalConstraint === 'string' ? VERTICAL[node.verticalConstraint] : undefined;
  const horizontal = typeof node.horizontalConstraint === 'string' ? HORIZONTAL[node.horizontalConstraint] : undefined;
  if (!vertical || !horizontal) return undefined;
  return { vertical, horizontal };
}

// ─── Stroke enums ───────────────────────────────────────────────────────────

export function mapStrokeAlign(value: unknown): StrokeAlign | undefined {
  return value === 'INSIDE' || value === 'OUTSIDE' || value === 'CENTER' ? value : undefined;
}

export function mapStrokeCap(value: unknown, ctx: MapperContext): StrokeCap | undefined {
  if (value === 'NONE' || value === 'ROUND' || value === 'SQUARE') return value;
  if (typeof value === 'string' && value.includes('ARROW')) {
    ctx.report.addUnsupported({ nodeId: ctx.nodeId, path: ctx.path, feature: `strokeCap:${value}` });
    return 'ARROW_LINES';
  }
  return undefined;
}

export function mapStrokeJoin(value: unknown): StrokeJoin | undefined {
  return value === 'MITER' || value === 'BEVEL' || value === 'ROUND' ? value : undefined;
}

// ─── Auto layout ────────────────────────────────────────────────────────────

function sizingMode(value: unknown): 'FIXED' | 'AUTO' | undefined {
  return value === 'FIXED' || value === 'AUTO' ? value : undefined;
}

function layoutSizing(value: unknown): 'FIXED' | 'HUG' | 'FILL' | undefined {
  return value === 'FIXED' || value === 'HUG' || value === 'FILL' ? value : undefined;
}

export function mapRestAutoLayout(node: FigmaRestNode, ctx: MapperContext): AutoLayout | undefined {
  const mode = node.layoutMode;
  if (mode !== 'HORIZONTAL' && mode !== 'VERTICAL') {
    if (mode === 'GRID') {
      ctx.report.addUnsupported({ nodeId: ctx.nodeId, path: ctx.path, feature: 'autoLayout:GRID' });
    }
    return undefined;
  }
  const layout: AutoLayout = { layoutMode: mode };
  const primary = sizingMode(node.primaryAxisSizingMode);
  if (primary) layout.primaryAxisSizingMode = primary;
  const counter = sizingMode(node.counterAxisSizingMode);
  if (counter) layout.counterAxisSizingMode = counter;
  if (typeof node.primaryAxisAlignItems === 'string') layout.primaryAxisAlignItems = node.primaryAxisAlignItems as AutoLayout['primaryAxisAlignItems'];
  if (typeof node.counterAxisAlignItems === 'string') layout.counterAxisAlignItems = node.counterAxisAlignItems as AutoLayout['counterAxisAlignItems'];
  if (typeof node.paddingTop === 'number') layout.paddingTop = node.paddingTop;
  if (typeof node.paddingRight === 'number') layout.paddingRight = node.paddingRight;
  if (typeof node.paddingBottom === 'number') layout.paddingBottom = node.paddingBottom;
  if (typeof node.paddingLeft === 'number') layout.paddingLeft = node.paddingLeft;
  if (typeof node.itemSpacing === 'number') layout.itemSpacing = node.itemSpacing;
  if (node.layoutWrap === 'NO_WRAP' || node.layoutWrap === 'WRAP') layout.layoutWrap = node.layoutWrap;
  const h = layoutSizing(node.layoutSizingHorizontal);
  if (h) layout.layoutSizingHorizontal = h;
  const v = layoutSizing(node.layoutSizingVertical);
  if (v) layout.layoutSizingVertical = v;
  return layout;
}

export function mapNativeAutoLayout(node: FigNode, ctx: MapperContext): AutoLayout | undefined {
  const mode = node.stackMode;
  if (mode !== 'HORIZONTAL' && mode !== 'VERTICAL') {
    if (mode === 'GRID') {
      ctx.report.addUnsupported({ nodeId: ctx.nodeId, path: ctx.path, feature: 'autoLayout:GRID' });
    }
    return undefined;
  }
  const layout: AutoLayout = { layoutMode: mode };
  const primary = sizingMode(node.stackPrimarySizing);
  if (primary) layout.primaryAxisSizingMode = primary;
  const counter = sizingMode(node.stackCounterSizing);
  if (counter) layout.counterAxisSizingMode = counter;
  if (typeof node.stackPrimaryAlignItems === 'string') layout.primaryAxisAlignItems = node.stackPrimaryAlignItems as AutoLayout['primaryAxisAlignItems'];
  if (typeof node.stackCounterAlignItems === 'string') layout.counterAxisAlignItems = node.stackCounterAlignItems as AutoLayout['counterAxisAlignItems'];
  // Native stores a single `stackPadding` plus horizontal/vertical and
  // right/bottom overrides (there are no per-side base fields).
  const base = typeof node.stackPadding === 'number' ? node.stackPadding : undefined;
  const horizontal = typeof node.stackHorizontalPadding === 'number' ? node.stackHorizontalPadding : base;
  const vertical = typeof node.stackVerticalPadding === 'number' ? node.stackVerticalPadding : base;
  if (vertical !== undefined) layout.paddingTop = vertical;
  if (horizontal !== undefined) layout.paddingLeft = horizontal;
  if (typeof node.stackPaddingBottom === 'number') layout.paddingBottom = node.stackPaddingBottom;
  else if (vertical !== undefined) layout.paddingBottom = vertical;
  if (typeof node.stackPaddingRight === 'number') layout.paddingRight = node.stackPaddingRight;
  else if (horizontal !== undefined) layout.paddingRight = horizontal;
  if (typeof node.stackSpacing === 'number') layout.itemSpacing = node.stackSpacing;
  if (node.stackWrap === 'NO_WRAP' || node.stackWrap === 'WRAP') layout.layoutWrap = node.stackWrap;
  const h = layoutSizing(node.stackPrimarySizing === 'AUTO' ? 'HUG' : undefined);
  if (h) layout.layoutSizingHorizontal = h;
  return layout;
}

// ─── Text ───────────────────────────────────────────────────────────────────

const TEXT_CASES: Record<string, TextStyle['textCase']> = {
  ORIGINAL: 'ORIGINAL',
  UPPER: 'UPPER',
  LOWER: 'LOWER',
  TITLE: 'TITLE',
};

function lineHeightFromRest(style: FigmaTypeStyle): TextStyle['lineHeight'] {
  if (style.lineHeightUnit === 'FONT_SIZE_%') {
    return { unit: 'PERCENT', value: style.lineHeightPercentFontSize ?? style.lineHeightPercent };
  }
  if (style.lineHeightUnit === 'INTRINSIC_%' || style.lineHeightUnit === undefined) {
    return style.lineHeightPx !== undefined ? { unit: 'PIXELS', value: style.lineHeightPx } : { unit: 'AUTO' };
  }
  return { unit: 'PIXELS', value: style.lineHeightPx };
}

/**
 * The face name a REST style describes.
 *
 * The REST API reports a face three ways and any of them may be the only one
 * present: `fontStyle` (a name, as the native format also carries), `italic`
 * (a flag, with no name at all), and `fontPostScriptName` (e.g. "Inter-BookItalic",
 * which still says the face). The name is kept descriptive — "Book Italic" must
 * not become "Italic" — because that is what survives an export round-trip.
 */
export function restFaceName(source: FigmaTypeStyle): string | null {
  const named = source.fontStyle?.trim() ?? '';
  if (named !== '') return named;
  const postScript = source.fontPostScriptName?.trim() ?? '';
  if (postScript !== '') {
    // "Family-BoldItalic" / "Family_SemiBold" / "Family_ExtraLight" -> the face.
    const separator = postScript.search(/[-_]/);
    const face = separator >= 0 ? postScript.slice(separator + 1) : '';
    const spaced = face
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_]+/g, ' ')
      .trim();
    if (spaced !== '' && !/^(regular|normal)$/i.test(spaced)) return spaced;
  }
  if (source.italic === true) return 'Italic';
  return null;
}

export function mapRestTextStyle(style: FigmaTypeStyle | undefined, ctx: MapperContext): TextStyle {
  const source = style ?? {};
  const mapped: TextStyle = {
    fontFamily: source.fontFamily ?? 'Inter',
    fontSize: source.fontSize ?? 12,
  };
  // A face name is kept when the payload names one; otherwise the italic flag
  // still carries the slant, so a REST-imported italic is not silently upright.
  const face = restFaceName(source);
  if (face !== null) mapped.fontStyle = face;
  else if (source.italic === true) mapped.fontStyle = 'Italic';
  if (typeof source.fontWeight === 'number') mapped.fontWeight = source.fontWeight;
  else {
    // No numeric weight in the payload: read it from the face name through the
    // same table the native path uses, so "Book Italic" is 400 and "Semi Bold
    // Oblique" keeps its 600 whichever way the file arrived.
    const weight = weightFromFaceName(face ?? (source.italic === true ? 'Italic' : null));
    if (weight !== null) mapped.fontWeight = weight;
  }
  mapped.lineHeight = lineHeightFromRest(source);
  if (typeof source.letterSpacing === 'number') mapped.letterSpacing = { unit: 'PIXELS', value: source.letterSpacing };
  if (source.textAlignHorizontal) mapped.textAlignHorizontal = source.textAlignHorizontal as TextStyle['textAlignHorizontal'];
  if (source.textAlignVertical) mapped.textAlignVertical = source.textAlignVertical as TextStyle['textAlignVertical'];
  if (source.textCase) {
    const textCase = TEXT_CASES[source.textCase];
    if (textCase) mapped.textCase = textCase;
    else ctx.report.addUnsupported({ nodeId: ctx.nodeId, path: ctx.path, feature: `textCase:${source.textCase}` });
  }
  if (source.textDecoration === 'NONE' || source.textDecoration === 'UNDERLINE' || source.textDecoration === 'STRIKETHROUGH') {
    mapped.textDecoration = source.textDecoration;
  }
  if (source.textAutoResize === 'NONE' || source.textAutoResize === 'WIDTH_AND_HEIGHT' || source.textAutoResize === 'HEIGHT' || source.textAutoResize === 'TRUNCATE') {
    mapped.textAutoResize = source.textAutoResize;
  }
  if (typeof source.paragraphSpacing === 'number') mapped.paragraphSpacing = source.paragraphSpacing;
  if (typeof source.paragraphIndent === 'number') mapped.paragraphIndent = source.paragraphIndent;
  return mapped;
}

/**
 * Native face name -> numeric weight. The native format carries no weight field,
 * so the style name *is* the weight; the exporter writes combined faces
 * ("Bold Italic"), so the italic variants are covered too.
 */
const STYLE_WEIGHTS: Record<string, number> = {
  thin: 100,
  'extra light': 200,
  light: 300,
  regular: 400,
  book: 400,
  medium: 500,
  'semi bold': 600,
  semibold: 600,
  bold: 700,
  'extra bold': 800,
  black: 900,
};

/**
 * The weight a face name implies, or null when the name says nothing about it.
 *
 * Shared by both import paths on purpose: the native format carries the weight
 * only as a name, and a REST payload often does too (a PostScript name or a bare
 * italic flag), so REST and native must read the same names the same way. A
 * trailing slant — "Italic" or "Oblique" — is stripped before the lookup, and a
 * bare slant means regular weight: it is the slant, not the weight.
 */
export function weightFromFaceName(styleName: string | null | undefined): number | null {
  const lower = (styleName ?? '').trim().toLowerCase();
  if (lower === '') return null;
  const italic = /italic|oblique/.test(lower);
  const base = italic ? lower.replace(/\s*(italic|oblique)$/, '').trim() : lower;
  if (base === '') return italic ? 400 : null;
  return STYLE_WEIGHTS[base] ?? null;
}

export function mapNativeTextStyle(node: FigNode, ctx: MapperContext): TextStyle {
  const mapped: TextStyle = {
    fontFamily: node.fontName?.family ?? 'Inter',
    fontSize: typeof node.fontSize === 'number' ? node.fontSize : 12,
  };
  if (node.fontName?.style) mapped.fontStyle = node.fontName.style;
  if (typeof node.fontWeight === 'number') mapped.fontWeight = node.fontWeight;
  else {
    // The native format has no numeric weight; it is carried by the style name.
    const weight = weightFromFaceName(node.fontName?.style);
    if (weight !== null) mapped.fontWeight = weight;
  }
  if (node.lineHeight) {
    const unit = node.lineHeight.units;
    if (unit === 'PERCENT') mapped.lineHeight = { unit: 'PERCENT', value: node.lineHeight.value };
    else if (unit === 'PIXELS') mapped.lineHeight = { unit: 'PIXELS', value: node.lineHeight.value };
    else mapped.lineHeight = { unit: 'AUTO' };
  } else {
    mapped.lineHeight = { unit: 'AUTO' };
  }
  if (node.letterSpacing && typeof node.letterSpacing.value === 'number') {
    mapped.letterSpacing = { unit: node.letterSpacing.units === 'PERCENT' ? 'PERCENT' : 'PIXELS', value: node.letterSpacing.value };
  }
  if (typeof node.textAlignHorizontal === 'string') mapped.textAlignHorizontal = node.textAlignHorizontal as TextStyle['textAlignHorizontal'];
  if (typeof node.textAlignVertical === 'string') mapped.textAlignVertical = node.textAlignVertical as TextStyle['textAlignVertical'];
  if (typeof node.textCase === 'string') {
    const textCase = TEXT_CASES[node.textCase];
    if (textCase) mapped.textCase = textCase;
    else ctx.report.addUnsupported({ nodeId: ctx.nodeId, path: ctx.path, feature: `textCase:${node.textCase}` });
  }
  if (node.textDecoration === 'NONE' || node.textDecoration === 'UNDERLINE' || node.textDecoration === 'STRIKETHROUGH') {
    mapped.textDecoration = node.textDecoration;
  }
  if (typeof node.textAutoResize === 'string') {
    mapped.textAutoResize = node.textAutoResize as TextStyle['textAutoResize'];
  }
  if (typeof node.paragraphSpacing === 'number') mapped.paragraphSpacing = node.paragraphSpacing;
  if (typeof node.paragraphIndent === 'number') mapped.paragraphIndent = node.paragraphIndent;
  return mapped;
}

/** Preserve per-character style overrides verbatim for round-tripping. */
export function textRuns(source: {
  characterStyleOverrides?: number[];
  styleOverrideTable?: unknown;
  lineTypes?: string[];
  lineIndentations?: number[];
}): unknown[] | undefined {
  const runs: Record<string, unknown> = {};
  if (Array.isArray(source.characterStyleOverrides)) runs.characterStyleOverrides = source.characterStyleOverrides;
  if (source.styleOverrideTable !== undefined) runs.styleOverrideTable = source.styleOverrideTable;
  if (Array.isArray(source.lineTypes)) runs.lineTypes = source.lineTypes;
  if (Array.isArray(source.lineIndentations)) runs.lineIndentations = source.lineIndentations;
  return Object.keys(runs).length > 0 ? [runs] : undefined;
}

// ─── Prototype interactions ─────────────────────────────────────────────────

/**
 * The `InteractionType` members, in the NATIVE vocabulary.
 *
 * Figma spells the drag trigger `DRAG` and the hover pair `MOUSE_IN`/`MOUSE_OUT`
 * as well as `MOUSE_ENTER`/`MOUSE_LEAVE`; listing only our names dropped those
 * triggers. The native spelling comes first, the model's own names are kept so a
 * document that already uses them still maps.
 */
const TRIGGERS: Record<string, PrototypeInteraction['trigger']['type']> = {
  ON_CLICK: 'ON_CLICK',
  ON_HOVER: 'ON_HOVER',
  ON_PRESS: 'ON_PRESS',
  DRAG: 'ON_DRAG',
  ON_DRAG: 'ON_DRAG',
  AFTER_TIMEOUT: 'AFTER_TIMEOUT',
  MOUSE_IN: 'MOUSE_ENTER',
  MOUSE_ENTER: 'MOUSE_ENTER',
  MOUSE_OUT: 'MOUSE_LEAVE',
  MOUSE_LEAVE: 'MOUSE_LEAVE',
  MOUSE_UP: 'MOUSE_UP',
  MOUSE_DOWN: 'MOUSE_DOWN',
};

/**
 * The `ConnectionType` members. The wire says `INTERNAL_NODE` for what the model
 * calls `NODE`; `NONE` maps to nothing, so the action is dropped rather than
 * invented.
 */
const ACTIONS: Record<string, PrototypeAction['type']> = {
  INTERNAL_NODE: 'NODE',
  NODE: 'NODE',
  BACK: 'BACK',
  CLOSE: 'CLOSE',
  URL: 'URL',
};

/**
 * The navigation members playback honours. Figma also sends SCROLL_TO and
 * CHANGE_TO; neither target is expressible here (a scroll offset, a variant
 * property set), so they are reported and the action dropped — never mapped onto
 * a frame navigation, which would play the wrong thing without saying so.
 */
const NAVIGATIONS = new Set<NonNullable<PrototypeAction['navigation']>>(['NAVIGATE', 'SWAP', 'OVERLAY', 'SWAP_STATE']);

/**
 * The REST API calls the variant swap `CHANGE_TO`; the native wire calls it
 * `SWAP_STATE`. Both mean the same action, and the model uses the NATIVE name
 * (its other members are native too). This is the same vocabulary split that hid
 * `dashPattern` and `windingRule`.
 */
const NAVIGATION_ALIASES: Record<string, NonNullable<PrototypeAction['navigation']>> = { CHANGE_TO: 'SWAP_STATE' };

export function mapRestInteractions(
  interactions: FigmaRestNode['interactions'],
  ctx: MapperContext,
): PrototypeInteraction[] | undefined {
  if (!Array.isArray(interactions) || interactions.length === 0) return undefined;
  const mapped: PrototypeInteraction[] = [];
  for (const interaction of interactions) {
    const triggerType = interaction.trigger?.type;
    const trigger = triggerType ? TRIGGERS[triggerType] : undefined;
    if (!trigger) {
      ctx.report.addUnsupported({ nodeId: ctx.nodeId, path: ctx.path, feature: `trigger:${triggerType ?? 'null'}` });
      continue;
    }
    const actions: PrototypeAction[] = [];
    for (const action of interaction.actions ?? []) {
      const type = ACTIONS[action.type];
      if (!type) {
        ctx.report.addUnsupported({ nodeId: ctx.nodeId, path: ctx.path, feature: `action:${action.type}` });
        continue;
      }
      const mappedAction: PrototypeAction = { type };
      if (action.destinationId !== undefined) mappedAction.destinationId = action.destinationId;
      if (action.url !== undefined) mappedAction.url = action.url;
      if (typeof action.navigation === 'string') {
        const navigation = NAVIGATION_ALIASES[action.navigation] ?? action.navigation;
        if (!NAVIGATIONS.has(navigation as NonNullable<PrototypeAction['navigation']>)) {
          ctx.report.addUnsupported({ nodeId: ctx.nodeId, path: ctx.path, feature: `navigation:${action.navigation}` });
          continue;
        }
        mappedAction.navigation = navigation as PrototypeAction['navigation'];
        // Playback branches on `overlay`, so an imported OVERLAY must set it too,
        // or the action would navigate instead of overlaying.
        if (navigation === 'OVERLAY') mappedAction.overlay = true;
      }
      if (action.transition) {
        mappedAction.transition = {
          type: action.transition.type,
          duration: action.transition.duration,
          easing: typeof action.transition.easing === 'string' ? action.transition.easing : undefined,
          direction: action.transition.direction,
        };
      }
      if (typeof action.preserveScrollPosition === 'boolean') mappedAction.preserveScrollPosition = action.preserveScrollPosition;
      actions.push(mappedAction);
    }
    if (actions.length > 0) {
      const entry: PrototypeInteraction = { trigger: { type: trigger }, actions };
      if (typeof interaction.trigger?.delay === 'number') entry.trigger.delay = interaction.trigger.delay;
      mapped.push(entry);
    }
  }
  return mapped.length > 0 ? mapped : undefined;
}

export { blendMode };
export type { TransformMatrix };
