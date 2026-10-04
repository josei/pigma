/**
 * Editor model → native `.fig` message.
 *
 * Implements the three-step plan from `docs/FIGMA_IMPORT.md`: map each editor
 * node to a `NodeChange`, carry geometry/text/auto-layout/paint fields, and
 * reuse the schema embedded in a seed `.fig` (no bundled schema copy).
 *
 * Vector geometry is encoded into `blobs` (see `encodeCommandsBlob`): nodes
 * whose `pathData` uses commands Pigma cannot encode are reported in
 * `warnings` and have their geometry omitted. Figma recomputes `fillGeometry`
 * on import, so a dropped blob does not invalidate the file.
 */
import { invert } from '../../model/matrix';
import type {
  PrototypeAction,
  LayoutGrid,
  AnyNode,
  AutoLayout,
  CanvasNode,
  ContainerNode,
  GradientPaint,
  Paint,
  PigmaFile,
  SceneNode,
  TextNode,
} from '../../model/types';
import { hasChildren } from '../../model/types';
import { exportFigBinary, readSeedSchema, zipArchive, type ExportCompressors } from './export';
import type { KiwiSchema } from './kiwi';
import type { Decompressors } from './zip';

export interface ModelExportOptions {
  /** A real `.fig`/`.deck`/`.jam` archive or bare `canvas.fig` providing the schema. */
  schemaFrom: Uint8Array;
  decompress: Decompressors;
  compress?: ExportCompressors;
  /** meta.json contents (defaults to a minimal document). */
  meta?: Record<string, unknown>;
  thumbnail?: Uint8Array;
  /** Images to embed, keyed by the image ref used in `ImagePaint.imageRef`. */
  images?: Map<string, Uint8Array>;
  sessionID?: number;
}

/** Encode SVG path data (absolute/relative M/L/H/V/C/Z) into a commands blob. */
export function encodeCommandsBlob(pathData: string): Uint8Array | null {
  const tokens = pathData.match(/[A-Za-z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi);
  if (!tokens || tokens.length === 0) return null;
  const bytes: number[] = [];
  const pushFloat = (value: number): void => {
    const buffer = new Uint8Array(4);
    new DataView(buffer.buffer).setFloat32(0, value, true);
    bytes.push(buffer[0] as number, buffer[1] as number, buffer[2] as number, buffer[3] as number);
  };
  let index = 0;
  let command = '';
  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;
  while (index < tokens.length) {
    const token = tokens[index] as string;
    if (/^[A-Za-z]$/.test(token)) {
      command = token;
      index += 1;
      if (command === 'Z' || command === 'z') {
        bytes.push(0x00);
        cx = startX;
        cy = startY;
      }
      continue;
    }
    const relative = command === command.toLowerCase();
    const num = (offset: number): number => Number(tokens[index + offset] ?? 0);
    switch (command.toUpperCase()) {
      case 'M': {
        const x = num(0);
        const y = num(1);
        index += 2;
        cx = relative ? cx + x : x;
        cy = relative ? cy + y : y;
        startX = cx;
        startY = cy;
        bytes.push(0x01);
        pushFloat(cx);
        pushFloat(cy);
        command = relative ? 'l' : 'L';
        break;
      }
      case 'L': {
        const x = num(0);
        const y = num(1);
        index += 2;
        cx = relative ? cx + x : x;
        cy = relative ? cy + y : y;
        bytes.push(0x02);
        pushFloat(cx);
        pushFloat(cy);
        break;
      }
      case 'H': {
        const x = num(0);
        index += 1;
        cx = relative ? cx + x : x;
        bytes.push(0x02);
        pushFloat(cx);
        pushFloat(cy);
        break;
      }
      case 'V': {
        const y = num(0);
        index += 1;
        cy = relative ? cy + y : y;
        bytes.push(0x02);
        pushFloat(cx);
        pushFloat(cy);
        break;
      }
      case 'C': {
        const c1xRaw = num(0);
        const c1yRaw = num(1);
        const c2xRaw = num(2);
        const c2yRaw = num(3);
        const xRaw = num(4);
        const yRaw = num(5);
        index += 6;
        const c1x = relative ? cx + c1xRaw : c1xRaw;
        const c1y = relative ? cy + c1yRaw : c1yRaw;
        const c2x = relative ? cx + c2xRaw : c2xRaw;
        const c2y = relative ? cy + c2yRaw : c2yRaw;
        cx = relative ? cx + xRaw : xRaw;
        cy = relative ? cy + yRaw : yRaw;
        bytes.push(0x04);
        pushFloat(c1x);
        pushFloat(c1y);
        pushFloat(c2x);
        pushFloat(c2y);
        pushFloat(cx);
        pushFloat(cy);
        break;
      }
      default:
        // Unsupported command (S/Q/T/A): geometry is skipped and reported.
        return null;
    }
  }
  return new Uint8Array(bytes);
}

interface ExportContext {
  sessionID: number;
  blobs: Uint8Array[];
  warnings: string[];
}

const ALPHABET_START = 0x21;
const ALPHABET_SIZE = 0x7e - 0x21 + 1;

/** Fixed-width base-94 position strings: lexicographic order == index order. */
function positionFor(index: number, total: number): string {
  const width = Math.max(1, Math.ceil(Math.log(total + 1) / Math.log(ALPHABET_SIZE)));
  let value = index;
  const chars: string[] = [];
  for (let i = 0; i < width; i++) {
    chars.unshift(String.fromCharCode(ALPHABET_START + (value % ALPHABET_SIZE)));
    value = Math.floor(value / ALPHABET_SIZE);
  }
  return chars.join('');
}

interface Guid {
  sessionID: number;
  localID: number;
}

let fallbackCounter = 0;

function guidFor(id: string, sessionID: number): Guid {
  const match = /^([0-9a-f]+):(\d+)$/.exec(id);
  if (match) {
    const session = Number.parseInt(match[1] as string, 16);
    return { sessionID: Number.isFinite(session) ? session : sessionID, localID: Number(match[2]) };
  }
  fallbackCounter += 1;
  return { sessionID, localID: 1_000_000 + fallbackCounter };
}

const NATIVE_TYPE: Record<string, string> = {
  DOCUMENT: 'DOCUMENT',
  CANVAS: 'CANVAS',
  FRAME: 'FRAME',
  GROUP: 'GROUP',
  SECTION: 'SECTION',
  RECTANGLE: 'RECTANGLE',
  ELLIPSE: 'ELLIPSE',
  LINE: 'LINE',
  POLYGON: 'REGULAR_POLYGON',
  STAR: 'STAR',
  VECTOR: 'VECTOR',
  TEXT: 'TEXT',
  COMPONENT: 'SYMBOL',
  // The native wire format has no COMPONENT_SET type; sets export as SYMBOL
  // (and re-import as COMPONENT). Documented limitation.
  COMPONENT_SET: 'SYMBOL',
  INSTANCE: 'INSTANCE',
  BOOLEAN_OPERATION: 'BOOLEAN_OPERATION',
  SLICE: 'SLICE',
};

const BLEND: Record<string, string> = {
  NORMAL: 'NORMAL',
  PASS_THROUGH: 'PASS_THROUGH',
  DARKEN: 'DARKEN',
  MULTIPLY: 'MULTIPLY',
  COLOR_BURN: 'COLOR_BURN',
  LIGHTEN: 'LIGHTEN',
  SCREEN: 'SCREEN',
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

function bytesFromHex(hex: string | undefined): Uint8Array | undefined {
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return undefined;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function toNativePaint(paint: Paint): Record<string, unknown> | null {
  const blend = paint.blendMode ? BLEND[paint.blendMode] : undefined;
  if (paint.type === 'SOLID') {
    const native: Record<string, unknown> = {
      type: 'SOLID',
      color: { r: paint.color.r, g: paint.color.g, b: paint.color.b, a: 1 },
      opacity: paint.opacity ?? 1,
      visible: paint.visible !== false,
    };
    if (blend) native.blendMode = blend;
    return native;
  }
  if (paint.type === 'IMAGE') {
    const hash = bytesFromHex(paint.imageRef);
    if (!hash) return null; // No embedded bytes available for this ref.
    const native: Record<string, unknown> = {
      type: 'IMAGE',
      image: { hash },
      visible: paint.visible !== false,
      opacity: paint.opacity ?? 1,
      imageScaleMode: paint.scaleMode === 'FIT' ? 'FIT' : paint.scaleMode === 'TILE' ? 'TILE' : 'FILL',
    };
    if (blend) native.blendMode = blend;
    return native;
  }
  if ('gradientStops' in paint) {
    const gradient = paint as unknown as GradientPaint;
    const native: Record<string, unknown> = {
      type: gradient.type,
      stops: gradient.gradientStops.map((stop) => ({
        position: stop.position,
        color: { r: stop.color.r, g: stop.color.g, b: stop.color.b, a: stop.color.a ?? 1 },
      })),
      visible: paint.visible !== false,
      opacity: paint.opacity ?? 1,
    };
    if (blend) native.blendMode = blend;
    const matrix = gradient.gradientTransform;
    if (matrix) {
      // The model stores gradient→object space; the native format stores the
      // inverse (node→gradient), matching the importer's inversion.
      const model = { a: matrix[0][0], b: matrix[1][0], c: matrix[0][1], d: matrix[1][1], tx: matrix[0][2], ty: matrix[1][2] };
      const nativeMatrix = invert(model);
      native.transform = {
        m00: nativeMatrix.a,
        m01: nativeMatrix.c,
        m02: nativeMatrix.tx,
        m10: nativeMatrix.b,
        m11: nativeMatrix.d,
        m12: nativeMatrix.ty,
      };
    }
    return native;
  }
  return null;
}

function toNativePaints(paints: Paint[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const paint of paints) {
    const native = toNativePaint(paint);
    if (native) out.push(native);
  }
  return out;
}

function toNativeEffects(effects: SceneNode['effects']): Array<Record<string, unknown>> {
  if (!effects) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const effect of effects) {
    if (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW') {
      out.push({
        type: effect.type,
        color: { r: effect.color.r, g: effect.color.g, b: effect.color.b, a: effect.color.a ?? 1 },
        offset: { x: effect.offset.x, y: effect.offset.y },
        radius: effect.radius,
        spread: effect.spread ?? 0,
        visible: effect.visible !== false,
        showShadowBehindNode: effect.showShadowBehindNode ?? false,
      });
    } else if (effect.type === 'LAYER_BLUR') {
      out.push({ type: 'FOREGROUND_BLUR', radius: effect.radius, visible: effect.visible !== false });
    } else if (effect.type === 'BACKGROUND_BLUR') {
      out.push({ type: 'BACKGROUND_BLUR', radius: effect.radius, visible: effect.visible !== false });
    }
  }
  return out;
}

function toNativeAutoLayout(layout: AutoLayout): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  // GRID is a stackMode too: without it a grid exported to .fig came back with no
  // auto layout at all.
  if (layout.layoutMode === 'HORIZONTAL' || layout.layoutMode === 'VERTICAL' || layout.layoutMode === 'GRID') {
    out.stackMode = layout.layoutMode;
  }
  if (layout.itemSpacing !== undefined) out.stackSpacing = layout.itemSpacing;
  // Native has a single `stackPadding` plus per-side overrides.
  if (layout.paddingTop !== undefined) out.stackPadding = layout.paddingTop;
  if (layout.paddingLeft !== undefined) out.stackHorizontalPadding = layout.paddingLeft;
  if (layout.paddingRight !== undefined) out.stackPaddingRight = layout.paddingRight;
  if (layout.paddingBottom !== undefined) out.stackPaddingBottom = layout.paddingBottom;
  // Native StackSize: FIXED | RESIZE_TO_FIT | RESIZE_TO_FIT_WITH_IMPLICIT_SIZE.
  const stackSize = (mode: 'FIXED' | 'AUTO' | undefined): string | undefined =>
    mode === undefined ? undefined : mode === 'AUTO' ? 'RESIZE_TO_FIT' : 'FIXED';
  const primary = stackSize(layout.primaryAxisSizingMode);
  const counter = stackSize(layout.counterAxisSizingMode);
  if (primary) out.stackPrimarySizing = primary;
  if (counter) out.stackCounterSizing = counter;
  if (layout.primaryAxisAlignItems) out.stackPrimaryAlignItems = layout.primaryAxisAlignItems;
  if (layout.counterAxisAlignItems) out.stackCounterAlignItems = layout.counterAxisAlignItems;
  if (layout.layoutWrap) out.stackWrap = layout.layoutWrap;
  return out;
}

/**
 * Numeric weight -> the face name the native format carries. The wire format has
 * no numeric weight field of its own, so the style name *is* the weight.
 */
const WEIGHT_STYLES: Record<number, string> = {
  100: 'Thin',
  200: 'Extra Light',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'Semi Bold',
  700: 'Bold',
  800: 'Extra Bold',
  900: 'Black',
};

/** The closest documented face for a numeric weight. */
function nearestWeightName(weight: number): string {
  const steps = Object.keys(WEIGHT_STYLES).map(Number);
  const closest = steps.reduce((best, step) => (Math.abs(step - weight) < Math.abs(best - weight) ? step : best), 400);
  return WEIGHT_STYLES[closest] ?? 'Regular';
}

/**
 * The face name to write for a text style.
 *
 * The editor stores the face twice: `fontWeight` (the number, which is what the
 * style controls write) and `fontStyle` (a name, which is what an imported file
 * carried). `fontStyle` is **always** present — the factory writes "Regular" and
 * the style controls write "normal" — so it cannot be trusted to describe the
 * weight: trusting it exported every bold node as "Regular".
 *
 * The rule is therefore: derive the face from the weight and the slant, then keep
 * the stored name only when it says something the derivation cannot — a family
 * face that is not one of the documented weights ("Book", "Display", "Book
 * Italic"). Anything the derivation would produce anyway ("Regular", "normal",
 * "Bold", "Bold Italic") is replaced by the derived name, which is identical, so
 * the stored name never has to be consistent with the weight for the export to be
 * right.
 */
export function wireFontStyle(style: { fontFamily?: string; fontStyle?: string; fontWeight?: number }): string {
  const raw = style.fontStyle?.trim() ?? '';
  const italic = /italic|oblique/i.test(raw);
  const base = nearestWeightName(style.fontWeight ?? 400);
  const derived = !italic ? base : base === 'Regular' ? 'Italic' : `${base} Italic`;
  if (raw === '') return derived;
  // Names the derivation reproduces exactly: a documented weight, its slanted
  // form, or a bare slant — compared case-insensitively, so "italic" from an
  // import is written as the format's own "Italic". ("Oblique" is the other
  // spelling of that slant: the wire format names one.)
  const lower = raw.toLowerCase();
  const lowerBase = base.toLowerCase();
  const derivable = new Set([
    lowerBase,
    'regular',
    'normal',
    'italic',
    'oblique',
    `${lowerBase} italic`,
    `${lowerBase} oblique`,
  ]);
  if (derivable.has(lower)) return derived;
  // A descriptive face — including a descriptive *italic* one — is kept as it
  // was written, so "Book Italic" does not become "Regular Italic".
  return raw;
}

function textFields(node: TextNode): Record<string, unknown> {
  const style = node.style;
  const out: Record<string, unknown> = { textData: { characters: node.characters } };
  if (style.fontSize !== undefined) out.fontSize = style.fontSize;
  // FontName is a struct: all three fields are required.
  out.fontName = { family: style.fontFamily ?? '', style: wireFontStyle(style), postscript: '' };
  if (style.textAlignHorizontal) out.textAlignHorizontal = style.textAlignHorizontal;
  if (style.textAlignVertical) out.textAlignVertical = style.textAlignVertical;
  if (style.textCase) out.textCase = style.textCase;
  if (style.textDecoration) out.textDecoration = style.textDecoration;
  if (style.paragraphSpacing !== undefined) out.paragraphSpacing = style.paragraphSpacing;
  if (style.paragraphIndent !== undefined) out.paragraphIndent = style.paragraphIndent;
  if (style.lineHeight) {
    // Number is a struct: value and units are both required.
    out.lineHeight = {
      value: style.lineHeight.value ?? 0,
      units: style.lineHeight.unit === 'PERCENT' ? 'PERCENT' : style.lineHeight.unit === 'PIXELS' ? 'PIXELS' : 'RAW',
    };
  }
  if (style.letterSpacing) {
    out.letterSpacing = { value: style.letterSpacing.value ?? 0, units: style.letterSpacing.unit === 'PERCENT' ? 'PERCENT' : 'PIXELS' };
  }
  return out;
}

function nodeChange(
  node: AnyNode,
  parentGuid: Guid | null,
  position: string | null,
  ctx: ExportContext,
): Record<string, unknown> {
  const change: Record<string, unknown> = {
    guid: guidFor(node.id, ctx.sessionID),
    phase: 'CREATED',
    type: NATIVE_TYPE[node.type] ?? 'FRAME',
    name: node.name,
    visible: node.visible,
    // `locked` was never written, so a locked layer came back unlocked with no
    // warning: the importer reads `locked === true` and a missing field is false.
    // Written only when true, like the other optional flags.
    ...(node.locked ? { locked: true } : {}),
    // `mask` is the native wire name (the schema's own); the importer reads it
    // back into the model's `isMask`.
    ...(node.isMask ? { mask: true } : {}),
    opacity: node.opacity,
    transform: {
      m00: node.transform.a,
      m01: node.transform.c,
      m02: node.transform.tx,
      m10: node.transform.b,
      m11: node.transform.d,
      m12: node.transform.ty,
    },
    size: { x: node.width, y: node.height },
    fillPaints: toNativePaints(node.fills),
    strokePaints: toNativePaints(node.strokes),
  };
  if (parentGuid && position) change.parentIndex = { guid: parentGuid, position };
  if (node.blendMode && BLEND[node.blendMode]) change.blendMode = BLEND[node.blendMode];
  // Constraints and the auto-layout child fields, under the schema's names.
  if (node.constraints) {
    change.horizontalConstraint = node.constraints.horizontal;
    change.verticalConstraint = node.constraints.vertical;
  }
  if (node.layoutAlign) change.stackCounterAlign = node.layoutAlign === 'STRETCH' ? 'STRETCH' : 'AUTO';
  if (typeof node.layoutGrow === 'number') change.stackChildPrimaryGrow = node.layoutGrow;
  if (node.strokeWeight !== undefined) change.strokeWeight = node.strokeWeight;
  if (node.strokeAlign) change.strokeAlign = node.strokeAlign;
  if (node.strokeCap) change.strokeCap = node.strokeCap;
  if (node.strokeJoin) change.strokeJoin = node.strokeJoin;
  // The NATIVE schema spells this `dashPattern`; `strokeDashes` is the REST API's
  // name, so writing it here made the encoder drop the field silently.
  if (node.dashPattern) change.dashPattern = node.dashPattern;
  const effects = toNativeEffects(node.effects);
  if (effects.length > 0) change.effects = effects;
  if (node.type === 'CANVAS') {
    const canvas = node as CanvasNode;
    if (canvas.backgroundColor) {
      change.backgroundColor = { ...canvas.backgroundColor, a: canvas.backgroundColor.a ?? 1 };
      change.backgroundEnabled = true;
    }
  }
  if (node.type === 'TEXT') {
    Object.assign(change, textFields(node as TextNode));
    // The schema's TextAutoResize enum has no TRUNCATE member, so only a member
    // is written; TRUNCATE stays unwritten and is reported by the field check.
    const autoResize = (node as TextNode).style.textAutoResize;
    if (autoResize === 'NONE' || autoResize === 'WIDTH_AND_HEIGHT' || autoResize === 'HEIGHT') {
      change.textAutoResize = autoResize;
    }
  }
  if ('cornerRadius' in node && node.cornerRadius !== undefined) change.cornerRadius = node.cornerRadius;
  if ('rectangleCornerRadii' in node && node.rectangleCornerRadii) {
    const [topLeft, topRight, bottomRight, bottomLeft] = node.rectangleCornerRadii;
    change.rectangleTopLeftCornerRadius = topLeft;
    change.rectangleTopRightCornerRadius = topRight;
    change.rectangleBottomRightCornerRadius = bottomRight;
    change.rectangleBottomLeftCornerRadius = bottomLeft;
    change.rectangleCornerRadiiIndependent = true;
  }
  if ('pathData' in node && node.pathData) {
    const blob = encodeCommandsBlob(node.pathData);
    if (blob) {
      // The schema's `WindingRule` enum spells the even-odd rule `ODD`, not
      // `EVENODD` (the REST API's spelling). Writing the model's value verbatim
      // made the encoder throw; writing NONZERO made an EVENODD path silently
      // wrong. Map it, and the importer maps `ODD` back.
      change.fillGeometry = [
        {
          windingRule: node.windingRule === 'EVENODD' ? 'ODD' : 'NONZERO',
          commandsBlob: ctx.blobs.length,
          styleID: 0,
        },
      ];
      ctx.blobs.push(blob);
    } else {
      ctx.warnings.push(`node ${node.id}: pathData uses unsupported commands; geometry omitted`);
    }
  }
  if ('autoLayout' in node && node.autoLayout) Object.assign(change, toNativeAutoLayout(node.autoLayout));
  if (node.interactions && node.interactions.length > 0) {
    change.prototypeInteractions = toNativeInteractions(node, ctx);
  }
  if ('autoLayout' in node && node.autoLayout?.layoutMode === 'GRID') {
    const layout = node.autoLayout;
    // The wire wants a GUIDPositionMap; our tracks are numeric, so a guid is
    // derived from the node id and the track index — deterministic, so a
    // round-tripped grid keeps the guids it was imported with.
    const mapOf = (guids: string[] | undefined, count: number, key: string) => ({
      entries: Array.from({ length: count }, (_, index) => ({
        guid: guidFor(guids?.[index] ?? `${node.id}:${key}:${index}`, ctx.sessionID),
        position: positionFor(index, Math.max(1, count)),
      })),
    });
    if (layout.gridColumns?.length) change.gridColumns = mapOf(layout.gridColumnGuids, layout.gridColumns.length, 'col');
    if (layout.gridRows?.length) change.gridRows = mapOf(layout.gridRowGuids, layout.gridRows.length, 'row');
    if (typeof layout.gridColumnGap === 'number') change.gridColumnGap = layout.gridColumnGap;
    if (typeof layout.gridRowGap === 'number') change.gridRowGap = layout.gridRowGap;
  }
  if (typeof node.gridColumnSpan === 'number') change.gridColumnSpan = node.gridColumnSpan;
  if (typeof node.gridRowSpan === 'number') change.gridRowSpan = node.gridRowSpan;
  if (node.gridColumnAnchorGuid) change.gridColumnAnchor = guidFor(node.gridColumnAnchorGuid, ctx.sessionID);
  if (node.gridRowAnchorGuid) change.gridRowAnchor = guidFor(node.gridRowAnchorGuid, ctx.sessionID);
  if ('layoutGrids' in node && node.layoutGrids && node.layoutGrids.length > 0) {
    change.layoutGrids = node.layoutGrids.map(toNativeLayoutGrid);
  }
  if ('clipsContent' in node && node.clipsContent !== undefined) change.frameMaskDisabled = !node.clipsContent;
  if ('overflowDirection' in node && node.overflowDirection && node.overflowDirection !== 'NONE') {
    change.overflowDirection = node.overflowDirection;
  }
  if ('booleanOperation' in node && node.booleanOperation) change.booleanOperation = node.booleanOperation;
  if ('boundVariables' in node && node.boundVariables && Object.keys(node.boundVariables).length > 0) {
    change.variableBindings = toNativeBindings(node.boundVariables as Record<string, string>);
  }
  if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
    const component = node as unknown as { componentPropertyDefinitions?: Record<string, unknown> };
    if (component.componentPropertyDefinitions) change.componentPropertyDefinitions = component.componentPropertyDefinitions;
  }
  if (node.type === 'INSTANCE') {
    const instance = node as SceneNode & { componentId?: string };
    if (instance.componentId) change.symbolData = { symbolID: guidFor(instance.componentId, ctx.sessionID) };
  }
  return change;
}

/**
 * A model layout grid as the schema's `LayoutGrid`.
 *
 * The shapes are a near match, not identical: the schema splits what the model
 * folds — `axis` distinguishes COLUMNS from ROWS and `pattern` is only
 * GRID/STRIPES, and `type` carries the ALIGNMENT (LayoutGridType is MIN/CENTER/
 * MAX/STRETCH). `numSections` is the model's `count`.
 */
function toNativeLayoutGrid(grid: LayoutGrid): Record<string, unknown> {
  const columns = grid.pattern === 'COLUMNS';
  return {
    type: grid.alignment ?? 'MIN',
    axis: columns ? 'X' : 'Y',
    visible: grid.visible !== false,
    numSections: grid.count ?? 1,
    offset: grid.offset ?? 0,
    sectionSize: grid.sectionSize,
    gutterSize: grid.gutterSize ?? 0,
    pattern: grid.pattern === 'GRID' ? 'GRID' : 'STRIPES',
    ...(grid.color ? { color: { ...grid.color, a: grid.color.a ?? 1 } } : {}),
  };
}

/**
 * The model's trigger names as the schema's `InteractionType` members.
 *
 * One rename: the model says `ON_DRAG`, the wire says `DRAG`. Everything else is
 * shared.
 */
const TRIGGER_TO_NATIVE: Record<string, string> = {
  ON_CLICK: 'ON_CLICK',
  ON_HOVER: 'ON_HOVER',
  ON_PRESS: 'ON_PRESS',
  ON_DRAG: 'DRAG',
  AFTER_TIMEOUT: 'AFTER_TIMEOUT',
  MOUSE_ENTER: 'MOUSE_ENTER',
  MOUSE_LEAVE: 'MOUSE_LEAVE',
  MOUSE_UP: 'MOUSE_UP',
  MOUSE_DOWN: 'MOUSE_DOWN',
};

/** The model's action kind as the schema's `ConnectionType` member. */
const CONNECTION_TO_NATIVE: Record<string, string> = { NODE: 'INTERNAL_NODE', BACK: 'BACK', CLOSE: 'CLOSE', URL: 'URL' };

/** One prototype action as the schema's `PrototypeAction`. */
function toNativeAction(action: PrototypeAction, ctx: ExportContext): Record<string, unknown> {
  const out: Record<string, unknown> = {
    connectionType: CONNECTION_TO_NATIVE[action.type] ?? 'NONE',
    // The destination is a node GUID, which is what `transitionNodeID` holds —
    // the same field SWAP_STATE uses, which is why the variant swap was always
    // expressible.
    ...(action.destinationId ? { transitionNodeID: guidFor(action.destinationId, ctx.sessionID) } : {}),
    ...(action.url ? { connectionURL: action.url } : {}),
    ...(action.navigation ? { navigationType: action.navigation } : {}),
    ...(action.overlayPosition === 'CUSTOM'
      ? { overlayRelativePosition: { x: action.overlayX ?? 0, y: action.overlayY ?? 0 } }
      : {}),
    ...(action.preserveScrollPosition ? { transitionPreserveScroll: true } : {}),
  };
  const transition = action.transition;
  if (transition) {
    out.transitionType = transition.type;
    if (typeof transition.duration === 'number') out.transitionDuration = transition.duration;
    if (typeof transition.easing === 'string') out.easingType = transition.easing;
    if (transition.type === 'SMART_ANIMATE') out.transitionShouldSmartAnimate = true;
  }
  return out;
}

/**
 * A node's prototype interactions as the schema's `PrototypeInteraction[]`.
 *
 * The importer reads NONE of this today, so writing it is the first half of a
 * mapper that makes prototype links survive a `.fig` round trip.
 */
function toNativeInteractions(node: AnyNode, ctx: ExportContext): Array<Record<string, unknown>> {
  return (node.interactions ?? []).map((interaction, index) => ({
    id: guidFor(`${node.id}:interaction:${index}`, ctx.sessionID),
    event: {
      interactionType: TRIGGER_TO_NATIVE[interaction.trigger.type] ?? 'ON_CLICK',
      ...(typeof interaction.trigger.delay === 'number' ? { interactionDuration: interaction.trigger.delay } : {}),
    },
    actions: interaction.actions.map((action) => toNativeAction(action, ctx)),
    isDeleted: false,
    stateManagementVersion: 0,
  }));
}

/** Model binding keys → Figma's `boundVariables` property names (alias objects). */
const BINDING_EXPORT_KEYS: Record<string, string> = {
  fill: 'fills',
  stroke: 'strokes',
  opacity: 'opacity',
  cornerRadius: 'cornerRadius',
  visible: 'visible',
  characters: 'characters',
};

function toNativeBindings(bindings: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [property, variableId] of Object.entries(bindings)) {
    const key = BINDING_EXPORT_KEYS[property];
    if (!key) continue;
    out[key] = { type: 'VARIABLE_ALIAS', id: variableId };
  }
  return out;
}

/** Build the decoded-message shape for a Pigma file. */
/**
 * Fields a user would notice losing, so the warning can say so rather than
 * emitting one generic line per field.
 */
const NOTICEABLE_FIELDS = new Set([
  'isMask',
  'interactions',
  'constraints',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'styles',
  'componentProperties',
  'componentPropertyReferences',
  'devStatus',
  'layoutGrids',
  // The message key, not the model field name: this list is matched against the
  // change object the encoder sees.
  'strokeDashes',
  'dashPattern',
]);

/**
 * Warn for every field a node change carries that the export's SCHEMA cannot
 * encode.
 *
 * The encoder is `kiwi-schema`'s, driven entirely by the `.fig` schema: it writes
 * the fields the schema defines and drops the rest with no warning. That is how
 * 15 model fields were lost silently. This does not make them encodable — the
 * schema is what it is — it makes the loss REPORTED, which is what the compat
 * table promises.
 *
 * One schema decode per export, and a warning names the field and the change.
 */
function warnUnencodableFields(
  nodeChanges: Array<Record<string, unknown>>,
  schema: KiwiSchema,
  warnings: string[],
): void {
  const byName = new Map(schema.definitions.map((definition) => [definition.name, definition]));
  // The top-level message names each array's element type; `nodeChanges` holds
  // `NodeChange`s. Without that definition every field is treated as encodable.
  const messageDefinition = schema.definitions.find((definition) => definition.fields.some((field) => field.name === 'nodeChanges'));
  const elementName = messageDefinition?.fields.find((field) => field.name === 'nodeChanges')?.type;
  const element = typeof elementName === 'string' ? byName.get(elementName) : undefined;
  if (!element) return;
  const encodable = new Set(element.fields.map((field) => field.name));
  const reported = new Set<string>();
  for (const change of nodeChanges) {
    const label = `${String(change.type ?? 'NODE')} ${JSON.stringify(change.name ?? '')}`;
    for (const key of Object.keys(change)) {
      if (encodable.has(key)) continue;
      const notice = NOTICEABLE_FIELDS.has(key) ? ' (a user would notice this)' : '';
      const line = `${label}: "${key}" is not defined by this .fig schema, so it cannot be written${notice}`;
      // One line per field per export: the same omission repeats on every node.
      if (reported.has(key)) continue;
      reported.add(key);
      warnings.push(line);
    }
  }
}

export function pigmaToFigMessage(
  file: PigmaFile,
  options: ModelExportOptions,
): { message: Record<string, unknown>; warnings: string[] } {
  const ctx: ExportContext = { sessionID: options.sessionID ?? 1, blobs: [], warnings: [] };
  const nodeChanges: Array<Record<string, unknown>> = [];
  const root = file.document;
  nodeChanges.push(nodeChange(root, null, null, ctx));

  const emit = (node: SceneNode, parentGuid: Guid, position: string): void => {
    nodeChanges.push(nodeChange(node, parentGuid, position, ctx));
    if (hasChildren(node)) {
      const children = (node as ContainerNode).children;
      const guid = guidFor(node.id, ctx.sessionID);
      children.forEach((child, index) => emit(child, guid, positionFor(index, children.length)));
    }
  };

  const pages = root.children;
  pages.forEach((page, pageIndex) => {
    nodeChanges.push(nodeChange(page, guidFor(root.id, ctx.sessionID), positionFor(pageIndex, pages.length), ctx));
    const children = page.children;
    children.forEach((child, index) => emit(child, guidFor(page.id, ctx.sessionID), positionFor(index, children.length)));
  });

  // Report what the schema cannot carry, before the caller encodes. A seed whose
  // schema cannot be read is left to the encoder to reject: this is a report, not
  // a new failure mode.
  try {
    warnUnencodableFields(nodeChanges, readSeedSchema(options.schemaFrom, options.decompress).schema, ctx.warnings);
  } catch {
    // No schema to check against; the export will fail on its own if it must.
  }

  return {
    message: {
      type: 'NODE_CHANGES',
      sessionID: ctx.sessionID,
      ackID: 0,
      nodeChanges,
      blobs: ctx.blobs.map((bytes) => ({ bytes })),
    },
    warnings: ctx.warnings,
  };
}

/** Export a Pigma file as a complete `.fig` archive. */
export async function exportPigmaFile(file: PigmaFile, options: ModelExportOptions): Promise<Uint8Array> {
  const { message } = pigmaToFigMessage(file, options);
  const canvas = await exportFigBinary(message, {
    schemaFrom: options.schemaFrom,
    decompress: options.decompress,
    compress: options.compress,
  });
  const entries: Array<[string, Uint8Array]> = [
    ['canvas.fig', canvas],
    [
      'meta.json',
      new TextEncoder().encode(
        JSON.stringify(options.meta ?? { file_name: file.name, version: String(file.lastModified ?? 1) }),
      ),
    ],
  ];
  if (options.thumbnail) entries.push(['thumbnail.png', options.thumbnail]);
  if (options.images) for (const [name, bytes] of options.images) entries.push([`images/${name}`, bytes]);
  if (entries.length < 3) {
    // Figma expects a thumbnail; a 1x1 transparent PNG keeps the archive valid.
    entries.push(['thumbnail.png', TRANSPARENT_PNG]);
  }
  return zipArchive(entries);
}

/** 1×1 transparent PNG, used when no thumbnail is supplied. */
const TRANSPARENT_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49,
  0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00,
  0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);
