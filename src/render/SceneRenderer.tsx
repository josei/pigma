import type { ReactNode } from 'react';
import type {
  BaseNode,
  Effect,
  ImagePaint,
  InstanceNode,
  Paint,
  PigmaFile,
  SceneNode,
  TextNode,
} from '../model/types';
import { hasChildren } from '../model/types';
import type { TextStyle, Transform } from '../model/types';
import { transformToCss } from '../model/matrix';
import { findNode } from '../model/tree';
import { gradientSpec } from '../model/paint';
import {
  gradientStopsToProps,
  gradientTransformAttr,
  needsPaintServerDef,
  rasterGradient,
  resolvePaint,
} from './paintRender';
import { resolveNodeVariables } from '../model/variables';
import { resolvedProperties, resolvePropertyReferences } from '../model/variants';
import { firstBaselineOffset, layoutText } from './textMetrics';

/** Deterministic def ids: the def collector and the node renderer must agree. */
function sanitize(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '_');
}
// One namespace for every fill paint: images and gradients both reference it.
const fillDefId = (nodeId: string, index: number) => `pigma-fill-${sanitize(nodeId)}-${index}`;
const strokeDefId = (nodeId: string, index: number) => `pigma-stroke-${sanitize(nodeId)}-${index}`;
const filterDefId = (nodeId: string) => `pigma-filter-${sanitize(nodeId)}`;
const clipDefId = (nodeId: string) => `pigma-clip-${sanitize(nodeId)}`;
/** The clip a mask node contributes to its siblings. */
const maskDefId = (nodeId: string) => `pigma-mask-${sanitize(nodeId)}`;
const strokeClipDefId = (nodeId: string, index: number) => `pigma-strokeclip-${sanitize(nodeId)}-${index}`;
const strokeMaskDefId = (nodeId: string, index: number) => `pigma-strokemask-${sanitize(nodeId)}-${index}`;

const BLEND_MODES: Record<string, string> = {
  NORMAL: 'normal',
  MULTIPLY: 'multiply',
  SCREEN: 'screen',
  OVERLAY: 'overlay',
  DARKEN: 'darken',
  LIGHTEN: 'lighten',
  COLOR_DODGE: 'color-dodge',
  COLOR_BURN: 'color-burn',
  HARD_LIGHT: 'hard-light',
  SOFT_LIGHT: 'soft-light',
  DIFFERENCE: 'difference',
  EXCLUSION: 'exclusion',
  HUE: 'hue',
  SATURATION: 'saturation',
  COLOR: 'color',
  LUMINOSITY: 'luminosity',
  PASS_THROUGH: 'normal',
};

/** Effects that need an SVG filter. */
function filterEffects(effects: Effect[] | undefined): Effect[] {
  return (effects ?? []).filter((effect) => effect.visible !== false);
}

export function cornerRadii(node: BaseNode): [number, number, number, number] {
  const shape = node as { cornerRadius?: number; rectangleCornerRadii?: [number, number, number, number] };
  if (shape.rectangleCornerRadii) return shape.rectangleCornerRadii;
  const radius = shape.cornerRadius ?? 0;
  return [radius, radius, radius, radius];
}

/** Rounded-rect path with independent corner radii (Figma's `rectangleCornerRadii`). */
export function roundedRectPath(width: number, height: number, radii: [number, number, number, number]): string {
  const max = Math.min(width, height) / 2;
  const [tl, tr, br, bl] = radii.map((r) => Math.max(0, Math.min(r, max))) as [number, number, number, number];
  if (tl === 0 && tr === 0 && br === 0 && bl === 0) {
    return `M 0 0 H ${width} V ${height} H 0 Z`;
  }
  return [
    `M ${tl} 0`,
    `H ${width - tr}`,
    tr > 0 ? `A ${tr} ${tr} 0 0 1 ${width} ${tr}` : `L ${width} 0`,
    `V ${height - br}`,
    br > 0 ? `A ${br} ${br} 0 0 1 ${width - br} ${height}` : `L ${width} ${height}`,
    `H ${bl}`,
    bl > 0 ? `A ${bl} ${bl} 0 0 1 0 ${height - bl}` : `L 0 ${height}`,
    `V ${tl}`,
    tl > 0 ? `A ${tl} ${tl} 0 0 1 ${tl} 0` : `L 0 0`,
    'Z',
  ].join(' ');
}

/**
 * Star/polygon geometry, matching Figma's pointCount/innerRadius model.
 *
 * `cornerRadius` rounds every corner, as Figma does: each vertex is cut back
 * along both of its edges by the radius and the gap is closed with an arc. The
 * cut is clamped to half the shorter adjacent edge, so a large radius on a small
 * shape rounds as far as the geometry allows instead of self-intersecting.
 */
export function starPath(
  width: number,
  height: number,
  pointCount: number,
  innerRadius: number,
  star: boolean,
  cornerRadius = 0,
): string {
  const cx = width / 2;
  const cy = height / 2;
  const rx = width / 2;
  const ry = height / 2;
  const total = Math.max(star ? 2 : 3, star ? pointCount * 2 : pointCount);
  const vertices: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < total; i += 1) {
    const angle = (i / total) * Math.PI * 2 - Math.PI / 2;
    const scale = star && i % 2 === 1 ? innerRadius : 1;
    vertices.push({ x: cx + Math.cos(angle) * rx * scale, y: cy + Math.sin(angle) * ry * scale });
  }
  const radius = Math.max(0, cornerRadius);
  if (radius <= 0) {
    return `M ${vertices.map((p) => `${p.x.toFixed(3)} ${p.y.toFixed(3)}`).join(' L ')} Z`;
  }

  const length = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(b.x - a.x, b.y - a.y);
  const towards = (from: { x: number; y: number }, to: { x: number; y: number }, distance: number) => {
    const span = length(from, to) || 1;
    const ratio = Math.min(0.5, distance / span);
    return { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio };
  };

  const segments: string[] = [];
  for (let i = 0; i < total; i += 1) {
    const previous = vertices[(i - 1 + total) % total]!;
    const vertex = vertices[i]!;
    const next = vertices[(i + 1) % total]!;
    // Clamp to half of the shorter edge so adjacent corners never overlap.
    const cut = Math.min(radius, length(vertex, previous) / 2, length(vertex, next) / 2);
    const entry = towards(vertex, previous, cut);
    const exit = towards(vertex, next, cut);
    segments.push(
      i === 0
        ? `M ${entry.x.toFixed(3)} ${entry.y.toFixed(3)}`
        : `L ${entry.x.toFixed(3)} ${entry.y.toFixed(3)}`,
    );
    segments.push(`A ${cut.toFixed(3)} ${cut.toFixed(3)} 0 0 1 ${exit.x.toFixed(3)} ${exit.y.toFixed(3)}`);
  }
  return `${segments.join(' ')} Z`;
}

/** Visible text lines for a node, applying wrapping and truncation rules. */
export function textLinesOf(node: TextNode): string[] {
  const autoResize = node.style.textAutoResize ?? 'WIDTH_AND_HEIGHT';
  if (autoResize === 'TRUNCATE') return [truncate(node.characters, node.style, node.width)];
  const wrap = autoResize === 'HEIGHT' || autoResize === 'NONE';
  return layoutText(node.characters, node.style, node.width, wrap).lines;
}

/** SVG path for a node's geometry (shared with the vector PDF exporter). */
export function shapePath(node: SceneNode): string | null {
  switch (node.type) {
    case 'RECTANGLE':
    case 'FRAME':
    case 'COMPONENT':
    case 'COMPONENT_SET':
    case 'INSTANCE':
    case 'SECTION':
    case 'GROUP': {
      const radii = cornerRadii(node);
      if (radii.some((r) => r > 0)) return roundedRectPath(node.width, node.height, radii);
      return null;
    }
    case 'ELLIPSE': {
      const rx = node.width / 2;
      const ry = node.height / 2;
      return `M 0 ${ry} A ${rx} ${ry} 0 1 0 ${node.width} ${ry} A ${rx} ${ry} 0 1 0 0 ${ry} Z`;
    }
    case 'POLYGON':
      return starPath(node.width, node.height, node.pointCount ?? 3, 1, false, node.cornerRadius ?? 0);
    case 'STAR':
      return starPath(
        node.width,
        node.height,
        node.pointCount ?? 5,
        node.innerRadius ?? 0.382,
        true,
        node.cornerRadius ?? 0,
      );
    case 'VECTOR':
    case 'BOOLEAN_OPERATION':
      return node.pathData ?? null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Def collection
// ---------------------------------------------------------------------------

function gradientDef(paint: Paint, id: string): ReactNode {
  const spec = gradientSpec(paint, id);
  if (!spec) return null;
  const stops = gradientStopsToProps(spec.stops);
  const shared = { gradientUnits: 'objectBoundingBox' as const, gradientTransform: gradientTransformAttr(spec) };
  const children = stops.map((stop, index) => (
    <stop key={index} offset={stop.offset} stopColor={stop.stopColor} stopOpacity={stop.stopOpacity} />
  ));
  switch (spec.kind) {
    case 'LINEAR':
      return (
        <linearGradient key={id} id={id} x1="0" y1="0" x2="1" y2="0" {...shared}>
          {children}
        </linearGradient>
      );
    case 'RADIAL':
      return (
        <radialGradient key={id} id={id} cx="0.5" cy="0.5" r="0.5" {...shared}>
          {children}
        </radialGradient>
      );
    default:
      // Angular/diamond gradients are rasterised when a DOM is available; without
      // one (server-side export) they degrade to a linear ramp of the same stops
      // rather than leaving the fill pointing at a missing def.
      return (
        <linearGradient key={id} id={id} x1="0" y1="0" x2="1" y2="0" {...shared}>
          {children}
        </linearGradient>
      );
  }
}

/**
 * Image fills paint through a pattern wrapping the bitmap:
 * `url(data:image/png;…)` is not a valid SVG paint server and renders nothing.
 *
 * `scaleMode` maps onto `preserveAspectRatio`: FILL/CROP cover the box, FIT
 * contains it, and **TILE repeats the bitmap**: the pattern tile is the image's
 * natural size times `scalingFactor`, so the pattern repeats it across the fill
 * area. `patternUnits="userSpaceOnUse"` is what makes that a real repetition —
 * with `objectBoundingBox` the tile would be a fraction of the box and the image
 * would still be stretched over it once.
 */
function imagePattern(paint: ImagePaint, id: string, width: number, height: number): ReactNode {
  if (!paint.dataUrl) return null;
  const box = { width: Math.max(width, 1), height: Math.max(height, 1) };
  const preserveAspectRatio = paint.scaleMode === 'FIT' ? 'xMidYMid meet' : 'xMidYMid slice';

  if (paint.scaleMode === 'TILE') {
    // The tile is the bitmap's own size (scaled), so the image repeats rather
    // than stretching once. Without a recorded natural size there is nothing to
    // repeat at, so the tile falls back to the node box.
    const scale = paint.scalingFactor && paint.scalingFactor > 0 ? paint.scalingFactor : 1;
    const tile = {
      width: Math.max(1, (paint.naturalWidth ?? box.width) * scale),
      height: Math.max(1, (paint.naturalHeight ?? box.height) * scale),
    };
    // Figma's tiling transform offsets the pattern: its translation is a
    // fraction of the tile, so the repeat can be aligned with the design.
    const offset = paint.imageTransform
      ? { x: paint.imageTransform[0][2] * tile.width, y: paint.imageTransform[1][2] * tile.height }
      : { x: 0, y: 0 };
    return (
      <pattern
        key={id}
        id={id}
        patternUnits="userSpaceOnUse"
        x={offset.x}
        y={offset.y}
        width={tile.width}
        height={tile.height}
      >
        <image href={paint.dataUrl} width={tile.width} height={tile.height} preserveAspectRatio="none" />
      </pattern>
    );
  }

  if (paint.scaleMode === 'CROP' && paint.imageTransform) {
    // The crop transform maps unit image space onto the box, so the inner image
    // is placed and scaled by it inside the pattern tile.
    const [[a, c, tx], [b, d, ty]] = paint.imageTransform;
    return (
      <pattern key={id} id={id} patternUnits="userSpaceOnUse" width={box.width} height={box.height}>
        <image
          href={paint.dataUrl}
          x={tx * box.width}
          y={ty * box.height}
          width={a * box.width}
          height={d * box.height}
          preserveAspectRatio="none"
          transform={
            c === 0 && b === 0 ? undefined : `matrix(${a} ${b} ${c} ${d} ${tx * box.width} ${ty * box.height})`
          }
        />
      </pattern>
    );
  }

  return (
    <pattern key={id} id={id} patternUnits="userSpaceOnUse" width={box.width} height={box.height}>
      <image href={paint.dataUrl} width={box.width} height={box.height} preserveAspectRatio={preserveAspectRatio} />
    </pattern>
  );
}

/** Angular/diamond gradients are rasterised; the bitmap is painted through a pattern. */
function rasterPattern(url: string, id: string, width: number, height: number): ReactNode {
  return (
    <pattern key={id} id={id} patternUnits="userSpaceOnUse" width={Math.max(width, 1)} height={Math.max(height, 1)}>
      <image href={url} width={Math.max(width, 1)} height={Math.max(height, 1)} preserveAspectRatio="none" />
    </pattern>
  );
}

function shadowFilterEffect(effect: Extract<Effect, { type: 'DROP_SHADOW' | 'INNER_SHADOW' }>, key: string): ReactNode[] {
  const color = `rgb(${Math.round(effect.color.r * 255)}, ${Math.round(effect.color.g * 255)}, ${Math.round(effect.color.b * 255)})`;
  const opacity = effect.color.a ?? 1;
  const spread = effect.spread ?? 0;
  if (effect.type === 'DROP_SHADOW') {
    return [
      spread !== 0 ? (
        <feMorphology key={`${key}-morph`} in="SourceAlpha" operator="dilate" radius={Math.abs(spread)} result={`${key}-dilate`} />
      ) : null,
      <feGaussianBlur
        key={`${key}-blur`}
        in={spread !== 0 ? `${key}-dilate` : 'SourceAlpha'}
        stdDeviation={Math.max(effect.radius / 2, 0.01)}
        result={`${key}-blur`}
      />,
      <feOffset key={`${key}-offset`} in={`${key}-blur`} dx={effect.offset.x} dy={effect.offset.y} result={`${key}-offset`} />,
      <feFlood key={`${key}-flood`} floodColor={color} floodOpacity={opacity} result={`${key}-color`} />,
      <feComposite key={`${key}-composite`} in={`${key}-color`} in2={`${key}-offset`} operator="in" result={`${key}-shadow`} />,
    ].filter(Boolean) as ReactNode[];
  }
  return [
    <feOffset key={`${key}-offset`} in="SourceAlpha" dx={effect.offset.x} dy={effect.offset.y} result={`${key}-offset`} />,
    <feGaussianBlur key={`${key}-blur`} in={`${key}-offset`} stdDeviation={Math.max(effect.radius / 2, 0.01)} result={`${key}-blur`} />,
    <feComponentTransfer key={`${key}-invert`} in={`${key}-blur`} result={`${key}-invert`}>
      <feFuncA type="table" tableValues="1 0" />
    </feComponentTransfer>,
    <feComposite key={`${key}-clip`} in={`${key}-invert`} in2="SourceAlpha" operator="in" result={`${key}-alpha`} />,
    <feFlood key={`${key}-flood`} floodColor={color} floodOpacity={opacity} result={`${key}-color`} />,
    <feComposite key={`${key}-composite`} in={`${key}-color`} in2={`${key}-alpha`} operator="in" result={`${key}-shadow`} />,
  ];
}

function effectFilter(node: BaseNode): ReactNode {
  const effects = filterEffects(node.effects);
  if (effects.length === 0) return null;
  const id = filterDefId(node.id);
  const primitives: ReactNode[] = [];
  const mergeInputs: string[] = [];
  let blurRadius = 0;

  effects.forEach((effect, index) => {
    const key = `e${index}`;
    if (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW') {
      primitives.push(...shadowFilterEffect(effect, key));
      mergeInputs.push(`${key}-shadow`);
    } else if (effect.type === 'LAYER_BLUR') {
      blurRadius = Math.max(blurRadius, effect.radius);
    }
  });

  if (blurRadius > 0) {
    primitives.push(<feGaussianBlur key="layer-blur" in="SourceGraphic" stdDeviation={blurRadius / 2} result="blurred" />);
  }

  const last = blurRadius > 0 ? 'blurred' : 'SourceGraphic';
  const merged: ReactNode[] = [
    ...primitives,
    <feMerge key="merge">
      {mergeInputs.map((input, index) => (
        <feMergeNode key={index} in={input} />
      ))}
      <feMergeNode in={last} />
    </feMerge>,
  ];

  return (
    <filter
      key={id}
      id={id}
      x="-50%"
      y="-50%"
      width="200%"
      height="200%"
      filterUnits="objectBoundingBox"
      colorInterpolationFilters="sRGB"
    >
      {merged}
    </filter>
  );
}

function paintDefs(node: SceneNode, paints: Paint[], idFor: (index: number) => string): ReactNode[] {
  const defs: ReactNode[] = [];
  paints.forEach((paint, index) => {
    if (!needsPaintServerDef(paint)) return;
    const id = idFor(index);
    if (paint.type === 'IMAGE') {
      defs.push(imagePattern(paint as ImagePaint, id, node.width, node.height));
      return;
    }
    const raster = rasterGradient(paint);
    if (raster) {
      defs.push(rasterPattern(raster, id, node.width, node.height));
      return;
    }
    defs.push(gradientDef(paint, id));
  });
  return defs;
}

/**
 * Whether a mask node needs a def at all.
 *
 * A mask clips the siblings above it, so a mask with nothing above it — or with
 * only another mask above it, which starts its own run — contributes no output.
 * The def is skipped, not just left unreferenced: an unreferenced `mask` is
 * still dead markup in the canvas and in every SVG/PNG export.
 */
function maskClipsSiblings(node: SceneNode, siblings: SceneNode[]): boolean {
  if (!node.isMask) return false;
  const at = siblings.indexOf(node);
  if (at < 0) return false;
  const next = siblings[at + 1];
  // Nothing above, or a mask directly above (it clips its own run instead).
  return next !== undefined && !next.isMask;
}

/** The axis-aligned box a node's own rect covers in its parent's space. */
function transformedBounds(node: SceneNode, pad: number): { x: number; y: number; width: number; height: number } {
  const { a, b, c, d, tx, ty } = node.transform;
  const corners = [
    [0, 0],
    [node.width, 0],
    [0, node.height],
    [node.width, node.height],
  ].map(([x, y]) => [a * x! + c * y! + tx, b * x! + d * y! + ty]);
  const xs = corners.map(([x]) => x!);
  const ys = corners.map(([, y]) => y!);
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  return { x: minX, y: minY, width: Math.max(...xs) + pad - minX, height: Math.max(...ys) + pad - minY };
}

/**
 * Whether a mask's paint is provably fully opaque inside its own outline and
 * nowhere else — the exact condition under which the geometry clip and the alpha
 * mask agree.
 *
 * That holds only for a mask that is fully opaque, has no strokes (a stroke
 * paints outside the outline), and has at least one opaque fill: an image fill
 * could carry its own alpha, and a partly transparent or gradient fill is
 * exactly the case alpha masking exists for. Everything else takes the `<mask>`
 * path.
 */
export function maskPaintIsOpaque(node: SceneNode): boolean {
  if ((node.opacity ?? 1) < 1) return false;
  // A blend mode changes what the paint composites against; do not vouch for it.
  if (node.blendMode && node.blendMode !== 'NORMAL' && node.blendMode !== 'PASS_THROUGH') return false;
  // A container masks by its children too, which this cannot inspect cheaply.
  // An empty child list is not a container's content — and imported documents
  // carry `children: []` on plain shapes, which must not disqualify them.
  if (hasChildren(node) && node.children.length > 0) return false;
  if (node.strokes.some((paint) => paint.visible !== false)) return false;
  const fills = node.fills.filter((paint) => paint.visible !== false);
  if (fills.length === 0) return false;
  // Every visible fill must be provably opaque: one translucent fill in the
  // stack means the composite is not the outline. This is deliberately
  // conservative — an opaque fill under a translucent one would still composite
  // to full alpha, but proving that is not worth a wrong answer.
  return fills.every(paintIsOpaque);
}

/**
 * Whether a single paint is provably fully opaque — the render path applies
 * `paint.opacity` to every paint type, so it is checked for every type, and any
 * doubt answers false. Callers must skip invisible paints first.
 */
function paintIsOpaque(paint: Paint): boolean {
  if ((paint.opacity ?? 1) < 1) return false;
  if (paint.blendMode && paint.blendMode !== 'NORMAL') return false;
  if (paint.type === 'SOLID') {
    // The render passes alpha 1 for a solid's colour today, so this is a
    // conservative extra check rather than a live difference.
    return ((paint.color as { a?: number }).a ?? 1) >= 1;
  }
  // An image fill carries its own alpha, which the document does not describe.
  if (paint.type === 'IMAGE') return false;
  const stops = (paint as { gradientStops?: Array<{ color: { a?: number } }> }).gradientStops;
  if (!stops) return false;
  return stops.every((stop) => (stop.color.a ?? 1) >= 1);
}

/**
 * The same node with every paint turned white, alpha untouched.
 *
 * Alpha masking ignores colour, so this changes nothing where `mask-type` is
 * honoured. Where a renderer falls back to luminance (the SVG default), white
 * has luminance 1, so the result is still the mask's alpha rather than its
 * colours — the classic white-mask trick. Image fills keep their own colours,
 * which is the one case a luminance renderer cannot resolve to alpha.
 */
function whitewashed(node: SceneNode): SceneNode {
  const paint = <T extends { type: string }>(source: T): T => {
    if (source.type === 'SOLID') return { ...source, color: { r: 1, g: 1, b: 1 } };
    const gradient = source as unknown as {
      gradientStops?: Array<{ position: number; color: { r: number; g: number; b: number; a?: number } }>;
    };
    if (!gradient.gradientStops) return source;
    return {
      ...source,
      gradientStops: gradient.gradientStops.map((stop) => ({ ...stop, color: { ...stop.color, r: 1, g: 1, b: 1 } })),
    };
  };
  return {
    ...node,
    fills: node.fills.map(paint),
    strokes: node.strokes.map(paint),
  } as SceneNode;
}

/**
 * The mask a node contributes, built from its own painted content.
 *
 * Figma masks by **alpha**: a mask's own alpha channel decides how much of the
 * layers above it shows through. There are two branches here, chosen by whether
 * alpha can matter at all:
 *
 *  - A **provably opaque** mask (`maskPaintIsOpaque`) clips by its outline. Its
 *    alpha is 1 inside that outline and 0 outside, so a `clipPath` and an alpha
 *    mask are exactly equivalent — and the clip costs less to rasterise.
 *  - Everything else becomes an SVG `<mask>`: an opaque fill (any colour,
 *    including black) masks fully, a semi-transparent fill partially masks so
 *    the covered layer fades, and a gradient or image fill masks by that fill.
 *
 * SVG `<mask>` defaults to **luminance**, which would invert all of that for
 * dark fills — an opaque black mask would mask nothing — so the mask declares
 * `mask-type="alpha"` (as both the presentation attribute and the inline style,
 * for renderer coverage) to match Figma. The content is also painted white with
 * its alpha untouched, so a renderer that ignores `mask-type` still resolves to
 * the mask's alpha rather than its colours (white has luminance 1). Image fills
 * keep their own colours, the one case a luminance renderer cannot resolve.
 *
 * The content is the mask's own paint (fills and strokes, at its own opacity).
 * The region is the mask's transformed box plus stroke room: SVG hides content
 * outside the mask region, and outside the mask's own geometry the alpha is zero
 * anyway, so the region only has to contain the mask's own paint — the masked
 * siblings may be far larger.
 */
function maskDef(node: SceneNode, file: PigmaFile): ReactNode | null {
  if (!node.isMask) return null;
  const id = maskDefId(node.id);
  const path = shapePath(node);
  const radii = cornerRadii(node);
  if (maskPaintIsOpaque(node)) {
    // Fully opaque: the outline and the alpha agree exactly, and a `clipPath`
    // costs less to rasterise.
    return (
      <clipPath key={id} id={id}>
        {path ? (
          <path d={path} transform={transformToCss(node.transform)} />
        ) : radii.some((r) => r > 0) ? (
          <path d={roundedRectPath(node.width, node.height, radii)} transform={transformToCss(node.transform)} />
        ) : (
          <rect x={0} y={0} width={Math.max(node.width, 0)} height={Math.max(node.height, 0)} transform={transformToCss(node.transform)} />
        )}
      </clipPath>
    );
  }
  const stroke = node.strokeWeight ?? 0;
  const pad = Math.max(stroke * 2, 8);
  // The region is in the parent's coordinate space, so it must cover the mask's
  // own box *after* its transform — SVG hides everything outside the region, and
  // a region at the origin would blank a mask that is placed anywhere else.
  const region = transformedBounds(node, pad);
  return (
    <mask
      key={id}
      id={id}
      maskUnits="userSpaceOnUse"
      maskContentUnits="userSpaceOnUse"
      mask-type="alpha"
      style={{ maskType: 'alpha' }}
      x={region.x}
      y={region.y}
      width={region.width}
      height={region.height}
    >
      <g transform={transformToCss(node.transform)} opacity={node.opacity < 1 ? node.opacity : undefined}>
        {fillShapes(whitewashed(node))}
        <StrokeShapes node={whitewashed(node)} path={path} />
        {/* A container masks by its content as well as its own paint. */}
        {childrenOf(file, node).map((child) => (
          <NodeView key={child.id} file={file} node={child} animation={null} />
        ))}
      </g>
    </mask>
  );
}

function clipDefs(node: SceneNode, siblings: SceneNode[], file: PigmaFile): ReactNode[] {
  const defs: ReactNode[] = [];
  if (maskClipsSiblings(node, siblings)) {
    const mask = maskDef(node, file);
    if (mask) defs.push(mask);
  }
  if (hasChildren(node) && node.clipsContent) {
    const id = clipDefId(node.id);
    const radii = cornerRadii(node);
    defs.push(
      <clipPath key={id} id={id}>
        {radii.some((r) => r > 0) ? (
          <path d={roundedRectPath(node.width, node.height, radii)} />
        ) : (
          <rect x={0} y={0} width={Math.max(node.width, 0)} height={Math.max(node.height, 0)} />
        )}
      </clipPath>,
    );
  }
  const path = shapePath(node);
  const strokeWeight = node.strokeWeight ?? 0;
  if (path && node.strokes.length > 0 && strokeWeight > 0 && node.strokeAlign && node.strokeAlign !== 'CENTER') {
    node.strokes.forEach((_, index) => {
      if (node.strokeAlign === 'INSIDE') {
        const id = strokeClipDefId(node.id, index);
        defs.push(
          <clipPath key={id} id={id}>
            <path d={path} />
          </clipPath>,
        );
      } else {
        const id = strokeMaskDefId(node.id, index);
        defs.push(
          <mask key={id} id={id} maskUnits="userSpaceOnUse" x={-strokeWeight} y={-strokeWeight} width={node.width + strokeWeight * 2} height={node.height + strokeWeight * 2}>
            <rect x={-strokeWeight} y={-strokeWeight} width={node.width + strokeWeight * 2} height={node.height + strokeWeight * 2} fill="#fff" />
            <path d={path} fill="#000" />
          </mask>,
        );
      }
    });
  }
  return defs;
}

/** Walk the scene once and emit every gradient/pattern/filter/clip/mask def. */
function collectDefs(file: PigmaFile, nodes: SceneNode[]): ReactNode[] {
  const defs: ReactNode[] = [];
  const visit = (node: SceneNode, siblings: SceneNode[]) => {
    defs.push(...paintDefs(node, node.fills, (index) => fillDefId(node.id, index)));
    defs.push(...paintDefs(node, node.strokes, (index) => strokeDefId(node.id, index)));
    const filter = effectFilter(node);
    if (filter) defs.push(filter);
    defs.push(...clipDefs(node, siblings, file));
    const children = childrenOf(file, node);
    for (const child of children) visit(child, children);
  };
  for (const node of nodes) visit(node, nodes);
  return defs;
}

// ---------------------------------------------------------------------------
// Node rendering
// ---------------------------------------------------------------------------

function childrenOf(file: PigmaFile, node: SceneNode): SceneNode[] {
  // A boolean's children are its operands, kept for editing: the rendered result
  // is the boolean's own path, so the operands must not paint on top of it.
  if (node.type === 'BOOLEAN_OPERATION') return [];
  if (!hasChildren(node)) return [];
  if (node.children.length > 0) return node.children as SceneNode[];
  if (node.type === 'INSTANCE') return instanceChildren(file, node);
  return [];
}

/**
 * Instances render their materialized children (falling back to the component),
 * with component-property references applied: a layer bound to a BOOLEAN or TEXT
 * property follows the instance's value.
 */
function instanceChildren(file: PigmaFile, instance: InstanceNode): SceneNode[] {
  const source = instance.children.length > 0
    ? (instance.children as SceneNode[])
    : (() => {
        const component = findNode(file.document, instance.componentId);
        return component && hasChildren(component) ? (component.children as SceneNode[]) : [];
      })();
  const values = resolvedProperties(file, instance);
  return source.map((child) => {
    const resolved = resolvePropertyReferences(child, values);
    return resolved ? ({ ...child, ...resolved } as SceneNode) : child;
  });
}

interface NodeViewProps {
  file: PigmaFile;
  node: SceneNode;
  animation?: SceneAnimation | null;
}

/** One SVG primitive per visible fill, stacked bottom-up like Figma paints. */
function fillShapes(node: SceneNode): ReactNode[] {
  const path = shapePath(node);
  const winding = node.type === 'VECTOR' || node.type === 'BOOLEAN_OPERATION' ? node.windingRule ?? 'NONZERO' : 'NONZERO';
  const fillRule = winding === 'EVENODD' ? ('evenodd' as const) : ('nonzero' as const);
  const shapes: ReactNode[] = [];

  node.fills.forEach((paint, index) => {
    if (paint.visible === false) return;
    const resolution = resolvePaint(paint, fillDefId(node.id, index));
    if (!resolution || resolution.value === 'none') return;
    const common = { fill: resolution.value, fillOpacity: resolution.opacity, fillRule };
    const key = `fill-${index}`;
    switch (node.type) {
      case 'ELLIPSE':
        shapes.push(
          <ellipse
            key={key}
            cx={node.width / 2}
            cy={node.height / 2}
            rx={Math.max(node.width / 2, 0)}
            ry={Math.max(node.height / 2, 0)}
            {...common}
          />,
        );
        break;
      case 'RECTANGLE':
      case 'FRAME':
      case 'COMPONENT':
      case 'COMPONENT_SET':
      case 'INSTANCE':
      case 'SECTION':
      case 'GROUP':
        shapes.push(
          path ? (
            <path key={key} d={path} {...common} />
          ) : (
            <rect key={key} x={0} y={0} width={Math.max(node.width, 0)} height={Math.max(node.height, 0)} {...common} />
          ),
        );
        break;
      case 'POLYGON':
      case 'STAR':
      case 'VECTOR':
      case 'BOOLEAN_OPERATION':
        if (path) shapes.push(<path key={key} d={path} {...common} />);
        break;
      default:
        break;
    }
  });
  return shapes;
}

const STROKE_CAP: Record<string, 'butt' | 'round' | 'square'> = {
  NONE: 'butt',
  ROUND: 'round',
  SQUARE: 'square',
  ARROW_LINES: 'butt',
  ARROW_EQUILATERAL: 'butt',
};

function StrokeShapes({ node, path }: { node: SceneNode; path: string | null }) {
  const weight = node.strokeWeight ?? 1;
  if (node.strokes.length === 0 || weight <= 0) return null;
  const align = node.strokeAlign ?? 'CENTER';
  return (
    <>
      {node.strokes.map((paint, index) => {
        if (paint.visible === false) return null;
        const resolution = resolvePaint(paint, strokeDefId(node.id, index));
        if (!resolution || resolution.value === 'none') return null;
        const common = {
          fill: 'none',
          stroke: resolution.value,
          strokeOpacity: resolution.opacity,
          strokeWidth: weight,
          strokeLinecap: STROKE_CAP[node.strokeCap ?? 'NONE'] ?? 'butt',
          strokeLinejoin: (node.strokeJoin ?? 'MITER').toLowerCase() as 'miter',
          strokeDasharray: node.dashPattern?.length ? node.dashPattern.join(' ') : undefined,
        };
        const clip = align === 'INSIDE' ? `url(#${strokeClipDefId(node.id, index)})` : undefined;
        const mask = align === 'OUTSIDE' ? `url(#${strokeMaskDefId(node.id, index)})` : undefined;
        let shape: ReactNode = null;
        if (node.type === 'LINE') {
          shape = <line x1={0} y1={0} x2={node.width} y2={0} {...common} />;
        } else if (node.type === 'ELLIPSE') {
          shape = <ellipse cx={node.width / 2} cy={node.height / 2} rx={Math.max(node.width / 2, 0)} ry={Math.max(node.height / 2, 0)} {...common} />;
        } else if (path) {
          shape = <path d={path} {...common} />;
        } else {
          shape = <rect x={0} y={0} width={Math.max(node.width, 0)} height={Math.max(node.height, 0)} {...common} />;
        }
        return (
          <g key={index} clipPath={clip} mask={mask}>
            {shape}
          </g>
        );
      })}
    </>
  );
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

function TextContent({ node }: { node: TextNode }) {
  const autoResize = node.style.textAutoResize ?? 'WIDTH_AND_HEIGHT';
  const wrap = autoResize === 'HEIGHT' || autoResize === 'NONE';
  const layout = layoutText(node.characters, node.style, node.width, wrap);
  const lineHeight = layout.lineHeight;
  const baseline = firstBaselineOffset(node.style);
  const weight = node.style.fontWeight ?? (node.style.fontStyle?.includes('Bold') ? 700 : 400);
  const fills = node.fills.filter((paint) => paint.visible !== false);
  const first = fills[0];
  const resolution = resolvePaint(first, fillDefId(node.id, 0));
  const align = node.style.textAlignHorizontal ?? 'LEFT';
  const anchor = align === 'CENTER' ? 'middle' : align === 'RIGHT' ? 'end' : 'start';
  const x = align === 'CENTER' ? node.width / 2 : align === 'RIGHT' ? node.width : 0;
  const vertical = node.style.textAlignVertical ?? 'TOP';
  const offsetY =
    vertical === 'CENTER'
      ? (node.height - layout.height) / 2
      : vertical === 'BOTTOM'
        ? node.height - layout.height
        : 0;
  const paragraphSpacing = node.style.paragraphSpacing ?? 0;
  const decoration = node.style.textDecoration ?? 'NONE';
  const lines = autoResize === 'TRUNCATE' ? [truncate(node.characters, node.style, node.width)] : layout.lines;

  return (
    <text
      x={x}
      y={offsetY + baseline}
      fill={resolution?.value ?? '#000000'}
      fillOpacity={resolution?.opacity ?? 1}
      fontFamily={node.style.fontFamily}
      fontSize={node.style.fontSize}
      fontWeight={weight}
      fontStyle={node.style.fontStyle}
      // Letter spacing changes the measured box, so it must reach the glyphs too.
      letterSpacing={letterSpacingOf(node.style)}
      textAnchor={anchor}
      xmlSpace="preserve"
      style={{
        whiteSpace: 'pre',
        textDecoration:
          decoration === 'UNDERLINE' ? 'underline' : decoration === 'STRIKETHROUGH' ? 'line-through' : undefined,
      }}
    >
      {lines.map((line, index) => (
        <tspan key={index} x={x} dy={index === 0 ? 0 : lineHeight + paragraphSpacing}>
          {line === '' ? ' ' : line}
        </tspan>
      ))}
    </text>
  );
}

/** Smart-animate context: which nodes animate and where they start. */
export interface SceneAnimation {
  /** Frame whose subtree is animating. */
  frameId: string;
  /** Ids of the layers taking part (they keep the CSS transition). */
  ids: Record<string, true>;
  /** Starting transforms, keyed by node id (cleared once the animation runs). */
  overrides: Record<string, Transform>;
  /** CSS transition, e.g. `transform 300ms ease-in-out`. */
  transition: string;
  /** Duration in milliseconds, used to drop the context once it has played. */
  duration: number;
}

/**
 * Render a parent's children, honouring masks.
 *
 * Figma's mask clips the siblings **above** it — the ones later in the child
 * order — so every run of siblings after a mask is wrapped in one clipped group.
 * The mask itself is a normal layer and stays visible, selectable and undoable;
 * a mask inside a frame, or a mask inside another mask's run, works because each
 * node renders its own children through this same function.
 */
function maskedSiblings(
  children: SceneNode[],
  file: PigmaFile,
  animation: SceneAnimation | null | undefined,
): ReactNode[] {
  const out: ReactNode[] = [];
  let clip: { clipPath: string } | { mask: string } | null = null;
  for (const child of children) {
    if (child.isMask) {
      // The mask paints itself, and clips whatever follows it. An opaque mask
      // contributes a clip path, a partly transparent one an alpha mask — the
      // reference must match the def that `maskDef` emits.
      const id = `url(#${maskDefId(child.id)})`;
      clip = maskPaintIsOpaque(child) ? { clipPath: id } : { mask: id };
      out.push(<NodeView key={child.id} file={file} node={child} animation={animation} />);
      continue;
    }
    out.push(
      clip ? (
        <g key={child.id} {...clip}>
          <NodeView file={file} node={child} animation={animation} />
        </g>
      ) : (
        <NodeView key={child.id} file={file} node={child} animation={animation} />
      ),
    );
  }
  return out;
}

function NodeView({ file, node, animation }: NodeViewProps) {
  // Variable bindings are resolved against the active mode here, so a mode switch
  // repaints without touching the document.
  const resolved = resolveNodeVariables(file, node);
  const target = resolved ? ({ ...node, ...resolved } as SceneNode) : node;
  if (!target.visible || target.opacity <= 0) return null;
  const children = childrenOf(file, target);
  const clip = hasChildren(target) && target.clipsContent ? `url(#${clipDefId(target.id)})` : undefined;
  const filter = filterEffects(target.effects).length > 0 ? `url(#${filterDefId(target.id)})` : undefined;
  const blend = target.blendMode && target.blendMode !== 'NORMAL' && target.blendMode !== 'PASS_THROUGH' ? BLEND_MODES[target.blendMode] : undefined;
  const path = shapePath(target);
  const animated = animation && animation.ids[target.id] ? animation : null;
  const transform = animated?.overrides[target.id] ?? target.transform;

  return (
    <g
      transform={animated ? undefined : transformToCss(target.transform)}
      opacity={target.opacity < 1 ? target.opacity : undefined}
      filter={filter}
      style={{
        ...(blend ? { mixBlendMode: blend as 'normal' } : {}),
        ...(animated ? { transform: transformToCss(transform), transition: animated.transition } : {}),
      }}
    >
      {target.type === 'TEXT' ? <TextContent node={target as TextNode} /> : fillShapes(target)}
      <StrokeShapes node={target} path={path} />
      {children.length > 0 ? (
        <g clipPath={clip}>
          {maskedSiblings(children, file, animation)}
        </g>
      ) : null}
    </g>
  );
}

export interface SceneSvgProps {
  file: PigmaFile;
  nodes: SceneNode[];
  /** Viewport rect in scene coordinates. */
  viewBox: { x: number; y: number; width: number; height: number };
  width: number;
  height: number;
  /** Frame/section name labels (canvas only, never exported). */
  showLabels?: boolean;
  /** Smart-animate context (presentation only). */
  animation?: SceneAnimation | null;
}

function FrameLabel({ node }: { node: SceneNode }) {
  if (!node.visible) return null;
  const label = `${node.name}`;
  return (
    <g transform={transformToCss(node.transform)}>
      <text x={0} y={-8} fontSize={11} fill="#0d99ff" style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500 }}>
        {label}
      </text>
    </g>
  );
}

/**
 * The single source of truth for scene rendering: the canvas mounts this
 * component, and the SVG exporter renders the very same tree to a string, so
 * exports always match what is on screen.
 */
export function SceneSvg({ file, nodes, viewBox, width, height, showLabels = false, animation = null }: SceneSvgProps) {
  const labelled = showLabels ? nodes.filter((node) => hasChildren(node)) : [];
  return (
    <svg
      className="canvas__svg"
      width={width}
      height={height}
      viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block' }}
    >
      <defs>{collectDefs(file, nodes)}</defs>
      {/* The top level is a parent too: a page-level mask clips the siblings
          above it exactly like one inside a frame. */}
      <g>{maskedSiblings(nodes, file, animation)}</g>
      {labelled.map((node) => (
        <FrameLabel key={`label-${node.id}`} node={node} />
      ))}
    </svg>
  );
}
