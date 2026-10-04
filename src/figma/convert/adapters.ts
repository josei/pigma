/**
 * Normalizes the two supported Figma sources — REST JSON and decoded native
 * `.fig` nodes — into a single intermediate shape consumed by `convert.ts`.
 *
 * The normalizer is the only place that knows each source's field names; the
 * converter then maps one shape onto the Pigma model. `raw` always points at
 * the original source object so nothing is lost.
 */
import type {
  AutoLayout,
  BaseNode,
  BlendMode,
  ComponentPropertyDefinition,
  ComponentPropertyType,
  ComponentPropertyValue,
  Constraints,
  Effect,
  Paint,
  PrototypeInteraction,
  RGBA,
  StrokeAlign,
  StrokeCap,
  StrokeJoin,
  TextStyle,
  TransformMatrix,
} from '../../model/types';
import { FigmaImportError } from '../errors';
import { isRecord } from '../internal/json';
import { figNodeId, resolveBlob, type FigDocument, type FigNode } from '../native/parse';
import { commandsToSvgPath, decodeCommandsBlob, parseVectorNetworkBlob, vectorNetworkToSvgPath } from '../native/vector';
import type { FigmaRestFile, FigmaRestNode } from '../rest/types';
import {
  blendMode,
  mapEffects,
  mapNativeAutoLayout,
  mapNativeConstraints,
  mapNativePaints,
  mapNativeTextStyle,
  mapRestAutoLayout,
  mapRestConstraints,
  mapRestInteractions,
  mapRestPaints,
  mapRestTextStyle,
  mapStrokeAlign,
  mapStrokeCap,
  mapStrokeJoin,
  textRuns,
} from './mappers';
import type { ReportBuilder } from './report';

export interface NormalizedNode {
  id: string;
  name: string;
  /** Raw source type string (e.g. `ROUNDED_RECTANGLE`, `STICKY`). */
  type: string;
  raw: Record<string, unknown>;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode?: BlendMode;
  /** Parent-relative transform, when the source provides one. */
  transform?: TransformMatrix;
  /** Absolute bounding box, when the source provides one. */
  absoluteBox?: { x: number; y: number; width: number; height: number } | null;
  rotation?: number;
  width: number;
  height: number;
  fills: Paint[];
  strokes: Paint[];
  strokeWeight?: number;
  strokeAlign?: StrokeAlign;
  strokeCap?: StrokeCap;
  strokeJoin?: StrokeJoin;
  dashPattern?: number[];
  effects: Effect[];
  constraints?: Constraints;
  /** Variable bindings, normalised to the model's property names. */
  bindings?: Record<string, string>;
  cornerRadius?: number;
  rectangleCornerRadii?: [number, number, number, number];
  pathData?: string;
  windingRule?: 'NONZERO' | 'EVENODD';
  pointCount?: number;
  innerRadius?: number;
  characters?: string;
  textStyle?: TextStyle;
  styleRuns?: unknown[];
  autoLayout?: AutoLayout;
  clipsContent?: boolean;
  /** Prototype scrolling (Figma's `overflowDirection`). */
  overflowDirection?: string;
  /** Boolean operation kind, for BOOLEAN_OPERATION nodes. */
  booleanOperation?: string;
  backgroundColor?: RGBA;
  componentId?: string;
  componentProperties?: Record<string, ComponentPropertyValue>;
  componentPropertyDefinitions?: Record<string, ComponentPropertyDefinition>;
  description?: string;
  interactions?: PrototypeInteraction[];
  /** Native FRAME nodes that are really groups (`resizeToFit`). */
  groupLike?: boolean;
  children: NormalizedNode[];
}

function linkChildren(
  byId: Map<string, NormalizedNode>,
  childIdsOf: (id: string) => string[],
): void {
  for (const [id, node] of byId) {
    const children: NormalizedNode[] = [];
    for (const childId of childIdsOf(id)) {
      const child = byId.get(childId);
      if (child) children.push(child);
    }
    node.children = children;
  }
}

// ─── REST ───────────────────────────────────────────────────────────────────

/**
 * Maps raw instance component properties to the model's name -> value shape.
 * REST delivers `{ type, value }`; native delivers plain values. Anything that
 * is not a string/boolean value is reported instead of coerced.
 */
function componentProperties(
  nodeId: string,
  path: string,
  raw: Record<string, unknown>,
  report: ReportBuilder,
): Record<string, ComponentPropertyValue> | undefined {
  const properties: Record<string, ComponentPropertyValue> = {};
  for (const [name, entry] of Object.entries(raw)) {
    const value = isRecord(entry) ? entry.value : entry;
    if (typeof value === 'string' || typeof value === 'boolean') {
      properties[name] = value;
      continue;
    }
    report.addUnsupported({
      nodeId,
      path,
      feature: 'instance:componentProperty',
      detail: `"${name}" has no string/boolean value`,
    });
  }
  return Object.keys(properties).length > 0 ? properties : undefined;
}

const COMPONENT_PROPERTY_TYPES: readonly ComponentPropertyType[] = ['VARIANT', 'BOOLEAN', 'TEXT', 'INSTANCE_SWAP'];

/**
 * Validates raw `componentPropertyDefinitions` into the model shape. Entries
 * that cannot be represented (unknown type, missing default) are reported
 * rather than coerced, so nothing is silently lost.
 */
function componentPropertyDefinitions(
  nodeId: string,
  path: string,
  raw: Record<string, unknown>,
  report: ReportBuilder,
): Record<string, ComponentPropertyDefinition> | undefined {
  const definitions: Record<string, ComponentPropertyDefinition> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (!isRecord(value)) {
      report.addUnsupported({ nodeId, path, feature: 'componentPropertyDefinition', detail: `"${name}" is not an object` });
      continue;
    }
    const type = value.type;
    if (typeof type !== 'string' || !(COMPONENT_PROPERTY_TYPES as readonly string[]).includes(type)) {
      report.addUnsupported({
        nodeId,
        path,
        feature: 'componentPropertyDefinition',
        detail: `"${name}" has unsupported type ${JSON.stringify(type)}`,
      });
      continue;
    }
    const defaultValue = value.defaultValue;
    if (typeof defaultValue !== 'string' && typeof defaultValue !== 'boolean') {
      report.addUnsupported({
        nodeId,
        path,
        feature: 'componentPropertyDefinition',
        detail: `"${name}" has no string/boolean defaultValue`,
      });
      continue;
    }
    const definition: ComponentPropertyDefinition = { type: type as ComponentPropertyType, defaultValue };
    if (Array.isArray(value.variantOptions)) {
      definition.variantOptions = value.variantOptions.filter((option): option is string => typeof option === 'string');
    }
    if (Array.isArray(value.preferredValues)) {
      const preferred: Array<{ type: 'COMPONENT' | 'COMPONENT_SET'; key: string }> = value.preferredValues.flatMap((entry) => {
        if (!isRecord(entry)) return [];
        const kind = entry.type;
        const key = entry.key;
        if ((kind === 'COMPONENT' || kind === 'COMPONENT_SET') && typeof key === 'string') return [{ type: kind, key }];
        return [];
      });
      if (preferred.length > 0) definition.preferredValues = preferred;
    }
    if (typeof value.description === 'string') definition.description = value.description;
    definitions[name] = definition;
  }
  return Object.keys(definitions).length > 0 ? definitions : undefined;
}

/** Figma's binding keys → the model's bindable property names. */
const BINDING_KEYS: Record<string, string> = {
  fills: 'fill',
  fill: 'fill',
  strokes: 'stroke',
  stroke: 'stroke',
  opacity: 'opacity',
  cornerRadius: 'cornerRadius',
  visible: 'visible',
  characters: 'characters',
};

/**
 * Normalise Figma's `boundVariables` (`{ fills: { type: 'VARIABLE_ALIAS', id } }`)
 * into the model's flat `property → variableId` map. Aliases may also arrive as a
 * plain id string or an array (Figma returns arrays for multi-fill bindings); the
 * first id wins, and anything the model cannot bind is reported.
 */
export function normalizeBindings(
  raw: unknown,
  ctx: { report: ReportBuilder; nodeId: string; path: string },
): Record<string, string> | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const bindings: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const property = BINDING_KEYS[key];
    const candidate = Array.isArray(value) ? value[0] : value;
    const id =
      typeof candidate === 'string'
        ? candidate
        : typeof candidate === 'object' && candidate !== null && typeof (candidate as { id?: unknown }).id === 'string'
          ? ((candidate as { id: string }).id)
          : null;
    if (!property) {
      ctx.report.addUnsupported({ nodeId: ctx.nodeId, path: ctx.path, feature: 'variable:binding', detail: `cannot bind ${key}` });
      continue;
    }
    if (!id) {
      ctx.report.addUnsupported({ nodeId: ctx.nodeId, path: ctx.path, feature: 'variable:binding', detail: `unreadable alias for ${key}` });
      continue;
    }
    bindings[property] = id;
  }
  return Object.keys(bindings).length > 0 ? bindings : undefined;
}

function adaptRestNode(node: FigmaRestNode, path: string, report: ReportBuilder): NormalizedNode {
  const ctx = { report, nodeId: node.id, path };
  const box = node.absoluteBoundingBox ?? null;
  const normalized: NormalizedNode = {
    id: node.id,
    name: typeof node.name === 'string' ? node.name : '',
    type: typeof node.type === 'string' ? node.type : 'UNKNOWN',
    raw: node,
    visible: node.visible !== false,
    locked: node.locked === true,
    opacity: typeof node.opacity === 'number' ? node.opacity : 1,
    width: node.size?.x ?? box?.width ?? 0,
    height: node.size?.y ?? box?.height ?? 0,
    fills: mapRestPaints(node.fills, ctx),
    strokes: mapRestPaints(node.strokes, ctx),
    effects: mapEffects(node.effects, ctx),
    children: [],
  };

  const bindings = normalizeBindings(node.boundVariables, ctx);
  if (bindings) normalized.bindings = bindings;
  if (node.relativeTransform) normalized.transform = node.relativeTransform;
  if (box) normalized.absoluteBox = box;
  if (typeof node.rotation === 'number') normalized.rotation = node.rotation;

  const mode = blendMode(node.blendMode, ctx, 'node');
  if (mode) normalized.blendMode = mode;
  if (typeof node.strokeWeight === 'number') normalized.strokeWeight = node.strokeWeight;
  const align = mapStrokeAlign(node.strokeAlign);
  if (align) normalized.strokeAlign = align;
  const cap = mapStrokeCap(node.strokeCap, ctx);
  if (cap) normalized.strokeCap = cap;
  const join = mapStrokeJoin(node.strokeJoin);
  if (join) normalized.strokeJoin = join;
  if (Array.isArray(node.strokeDashes)) normalized.dashPattern = node.strokeDashes;
  const constraints = mapRestConstraints(node);
  if (constraints) normalized.constraints = constraints;
  if (typeof node.cornerRadius === 'number') normalized.cornerRadius = node.cornerRadius;
  const corners = [
    node.rectangleTopLeftCornerRadius,
    node.rectangleTopRightCornerRadius,
    node.rectangleBottomRightCornerRadius,
    node.rectangleBottomLeftCornerRadius,
  ];
  if (corners.every((value) => typeof value === 'number')) {
    normalized.rectangleCornerRadii = [corners[0] as number, corners[1] as number, corners[2] as number, corners[3] as number];
  } else if (Array.isArray(node.rectangleCornerRadii) && node.rectangleCornerRadii.length === 4) {
    normalized.rectangleCornerRadii = [
      node.rectangleCornerRadii[0] as number,
      node.rectangleCornerRadii[1] as number,
      node.rectangleCornerRadii[2] as number,
      node.rectangleCornerRadii[3] as number,
    ];
  }
  const autoLayout = mapRestAutoLayout(node, ctx);
  if (autoLayout) normalized.autoLayout = autoLayout;
  if (typeof node.clipsContent === 'boolean') normalized.clipsContent = node.clipsContent;
  if (typeof node.overflowDirection === 'string') normalized.overflowDirection = node.overflowDirection;
  if (typeof node.booleanOperation === 'string') normalized.booleanOperation = node.booleanOperation;
  if (node.arcData) {
    report.addUnsupported({
      nodeId: node.id,
      path,
      feature: 'ellipse:arcData',
      detail: 'arc angles are retained in node.raw but have no Pigma field',
    });
  }
  if (typeof node.pointCount === 'number') normalized.pointCount = node.pointCount;
  if (typeof node.innerRadius === 'number') normalized.innerRadius = node.innerRadius;

  const geometry = Array.isArray(node.fillGeometry) ? node.fillGeometry : [];
  if (geometry.length > 0) {
    const paths = geometry.map((entry) => entry.path).filter((value): value is string => typeof value === 'string');
    if (paths.length > 0) normalized.pathData = paths.join(' ');
    normalized.windingRule = geometry[0]?.windingRule === 'EVENODD' ? 'EVENODD' : 'NONZERO';
  }

  if (typeof node.characters === 'string') normalized.characters = node.characters;
  if (node.type === 'TEXT') {
    normalized.textStyle = mapRestTextStyle(node.style, ctx);
    normalized.styleRuns = textRuns({
      characterStyleOverrides: node.characterStyleOverrides,
      styleOverrideTable: node.styleOverrideTable,
      lineTypes: node.lineTypes,
      lineIndentations: node.lineIndentations,
    });
  }

  if (typeof node.componentId === 'string') normalized.componentId = node.componentId;
  if (node.componentProperties) {
    normalized.componentProperties = componentProperties(node.id, path, node.componentProperties, report);
  }
  if (node.componentPropertyDefinitions) {
    normalized.componentPropertyDefinitions = componentPropertyDefinitions(node.id, path, node.componentPropertyDefinitions, report);
  }
  if (typeof node.description === 'string') normalized.description = node.description;
  if (Array.isArray(node.overrides) && node.overrides.length > 0) {
    report.addUnsupported({
      nodeId: node.id,
      path,
      feature: 'instance:overrides',
      detail: 'REST lists overridden field names only; values are already present on the instance subtree',
    });
  }

  const interactions = mapRestInteractions(node.interactions, ctx);
  if (interactions) normalized.interactions = interactions;
  if (node.type === 'CANVAS' && node.backgroundColor) normalized.backgroundColor = node.backgroundColor;

  return normalized;
}

/** Normalize a REST source (full file or nodes response). */
export function adaptRestTree(source: FigmaRestFile, report: ReportBuilder): NormalizedNode[] {
  const byId = new Map<string, NormalizedNode>();
  const sources = new Map<string, FigmaRestNode>();
  const stack: Array<{ node: FigmaRestNode; path: string }> = source.roots.map((node, index) => ({
    node,
    path: `roots[${index}]`,
  }));

  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) break;
    const { node, path } = frame;
    if (byId.has(node.id)) continue;
    byId.set(node.id, adaptRestNode(node, path, report));
    sources.set(node.id, node);
    const children = node.children;
    if (Array.isArray(children)) {
      for (let i = children.length - 1; i >= 0; i--) {
        const child = children[i];
        if (child) stack.push({ node: child, path: `${path}.children[${i}]` });
      }
    }
  }

  linkChildren(byId, (id) => (sources.get(id)?.children ?? []).map((child) => child.id));

  const roots: NormalizedNode[] = [];
  for (const root of source.roots) {
    const node = byId.get(root.id);
    if (node) roots.push(node);
  }
  return roots;
}

// ─── Native ─────────────────────────────────────────────────────────────────

function nativePathData(
  doc: FigDocument,
  node: FigNode,
  path: string,
  report: ReportBuilder,
): { pathData?: string; windingRule?: 'NONZERO' | 'EVENODD' } {
  const parts: string[] = [];
  let windingRule: 'NONZERO' | 'EVENODD' | undefined;
  const geometry = Array.isArray(node.fillGeometry) ? node.fillGeometry : [];
  for (const entry of geometry) {
    const bytes = resolveBlob(doc, entry.commandsBlob);
    if (!bytes) {
      report.addUnsupported({ nodeId: figNodeId(node) ?? undefined, path, feature: 'vector:missingBlob' });
      continue;
    }
    try {
      parts.push(commandsToSvgPath(decodeCommandsBlob(bytes)));
    } catch (cause) {
      report.addUnsupported({
        nodeId: figNodeId(node) ?? undefined,
        path,
        feature: 'vector:commandsBlob',
        detail: cause instanceof Error ? cause.message : String(cause),
      });
      continue;
    }
    if (!windingRule) windingRule = entry.windingRule === 'ODD' ? 'EVENODD' : 'NONZERO';
  }

  if (parts.length === 0 && node.vectorData?.vectorNetworkBlob !== undefined) {
    const bytes = resolveBlob(doc, node.vectorData.vectorNetworkBlob);
    if (bytes) {
      try {
        const network = parseVectorNetworkBlob(bytes);
        const normalizedSize = node.vectorData.normalizedSize;
        const scaleX = normalizedSize?.x ? (node.size?.x ?? normalizedSize.x) / normalizedSize.x : 1;
        const scaleY = normalizedSize?.y ? (node.size?.y ?? normalizedSize.y) / normalizedSize.y : 1;
        parts.push(vectorNetworkToSvgPath(network, scaleX, scaleY));
        windingRule = network.regions[0]?.windingRule ?? 'NONZERO';
      } catch (cause) {
        report.addUnsupported({
          nodeId: figNodeId(node) ?? undefined,
          path,
          feature: 'vector:vectorNetworkBlob',
          detail: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }
  }

  const result: { pathData?: string; windingRule?: 'NONZERO' | 'EVENODD' } = {};
  if (parts.length > 0) result.pathData = parts.join(' ');
  if (windingRule) result.windingRule = windingRule;
  return result;
}

function adaptNativeNode(doc: FigDocument, node: FigNode, path: string, report: ReportBuilder): NormalizedNode {
  const id = figNodeId(node) ?? '';
  const ctx = { report, nodeId: id, path, images: doc.images };
  const normalized: NormalizedNode = {
    id,
    name: typeof node.name === 'string' ? node.name : '',
    type: typeof node.type === 'string' ? node.type : 'UNKNOWN',
    raw: node,
    visible: node.visible !== false,
    locked: node.locked === true,
    opacity: typeof node.opacity === 'number' ? node.opacity : 1,
    width: typeof node.size?.x === 'number' ? node.size.x : 0,
    height: typeof node.size?.y === 'number' ? node.size.y : 0,
    fills: mapNativePaints(node.fillPaints, ctx),
    strokes: mapNativePaints(node.strokePaints, ctx),
    effects: mapEffects(node.effects, ctx),
    children: [],
  };

  const nativeBindings = normalizeBindings(
    (node as FigNode & { variableBindings?: unknown }).variableBindings ??
      (node as FigNode & { boundVariables?: unknown }).boundVariables,
    ctx,
  );
  if (nativeBindings) normalized.bindings = nativeBindings;
  if (node.transform) {
    normalized.transform = [
      [node.transform.m00, node.transform.m01, node.transform.m02],
      [node.transform.m10, node.transform.m11, node.transform.m12],
    ];
  }

  const mode = blendMode(node.blendMode, ctx, 'node');
  if (mode) normalized.blendMode = mode;
  if (typeof node.strokeWeight === 'number') normalized.strokeWeight = node.strokeWeight;
  const align = mapStrokeAlign(node.strokeAlign);
  if (align) normalized.strokeAlign = align;
  const cap = mapStrokeCap(node.strokeCap, ctx);
  if (cap) normalized.strokeCap = cap;
  const join = mapStrokeJoin(node.strokeJoin);
  if (join) normalized.strokeJoin = join;
  const constraints = mapNativeConstraints(node);
  if (constraints) normalized.constraints = constraints;
  if (typeof node.cornerRadius === 'number') normalized.cornerRadius = node.cornerRadius;
  const corners = [
    node.rectangleTopLeftCornerRadius,
    node.rectangleTopRightCornerRadius,
    node.rectangleBottomRightCornerRadius,
    node.rectangleBottomLeftCornerRadius,
  ];
  if (corners.every((value) => typeof value === 'number')) {
    normalized.rectangleCornerRadii = [corners[0] as number, corners[1] as number, corners[2] as number, corners[3] as number];
  } else if (Array.isArray(node.rectangleCornerRadii) && node.rectangleCornerRadii.length === 4) {
    normalized.rectangleCornerRadii = [
      node.rectangleCornerRadii[0] as number,
      node.rectangleCornerRadii[1] as number,
      node.rectangleCornerRadii[2] as number,
      node.rectangleCornerRadii[3] as number,
    ];
  }
  const autoLayout = mapNativeAutoLayout(node, ctx);
  if (autoLayout) normalized.autoLayout = autoLayout;
  if (typeof node.clipsContent === 'boolean') normalized.clipsContent = node.clipsContent;
  if (typeof node.overflowDirection === 'string') normalized.overflowDirection = node.overflowDirection;
  if (typeof node.booleanOperation === 'string') normalized.booleanOperation = node.booleanOperation;
  // `frameMaskDisabled: false` means the frame clips (the default).
  if (typeof node.frameMaskDisabled === 'boolean') normalized.clipsContent = !node.frameMaskDisabled;
  if (typeof node.overflowDirection === 'string') normalized.overflowDirection = node.overflowDirection;
  if (typeof node.booleanOperation === 'string') normalized.booleanOperation = node.booleanOperation;
  if (node.type === 'FRAME' && node.resizeToFit === true && !normalized.autoLayout) normalized.groupLike = true;

  if (node.type === 'VECTOR' || node.type === 'BOOLEAN_OPERATION' || node.fillGeometry) {
    const { pathData, windingRule } = nativePathData(doc, node, path, report);
    if (pathData) normalized.pathData = pathData;
    if (windingRule) normalized.windingRule = windingRule;
  }
  if (typeof node.pointCount === 'number') normalized.pointCount = node.pointCount;
  if (typeof node.innerRadius === 'number') normalized.innerRadius = node.innerRadius;

  const characters = node.textData?.characters;
  if (typeof characters === 'string') normalized.characters = characters;
  if (node.type === 'TEXT') {
    normalized.textStyle = mapNativeTextStyle(node, ctx);
    normalized.styleRuns = textRuns({
      characterStyleOverrides: node.characterStyleOverrides,
      styleOverrideTable: node.styleOverrideTable,
    });
  }

  if (node.type === 'INSTANCE') {
    const symbol = node.symbolData as { symbolID?: { sessionID: number; localID: number } } | undefined;
    if (symbol?.symbolID) {
      normalized.componentId = `${symbol.symbolID.sessionID}:${symbol.symbolID.localID}`;
    } else if (typeof node.componentId === 'string') {
      normalized.componentId = node.componentId;
    } else {
      report.addUnsupported({ nodeId: id, path, feature: 'instance:componentId' });
    }
    if (node.symbolOverrides || node.overrides) {
      report.addUnsupported({
        nodeId: id,
        path,
        feature: 'instance:overrides',
        detail: 'native symbol overrides are retained in node.raw but not materialized',
      });
    }
  }
  if (node.type === 'SYMBOL' || node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
    const definitions = node.componentPropertyDefinitions;
    if (definitions && typeof definitions === 'object') {
      normalized.componentPropertyDefinitions = componentPropertyDefinitions(id, path, definitions as Record<string, unknown>, report);
    }
  }

  if (node.type === 'CANVAS') {
    if (node.backgroundEnabled === false) {
      normalized.backgroundColor = { r: 0, g: 0, b: 0, a: 0 };
    } else if (node.backgroundColor) {
      normalized.backgroundColor = node.backgroundColor;
    }
  }

  return normalized;
}

function sortedNativeChildren(doc: FigDocument, parentId: string): FigNode[] {
  const children = (doc.childrenMap.get(parentId) ?? []).filter((child) => child.phase !== 'REMOVED');
  return children.sort((a, b) => {
    const pa = a.parentIndex?.position ?? '';
    const pb = b.parentIndex?.position ?? '';
    return pa < pb ? -1 : pa > pb ? 1 : 0;
  });
}

/** Normalize a decoded native document, rooted at its DOCUMENT node. */
export function adaptNativeTree(doc: FigDocument, report: ReportBuilder): NormalizedNode[] {
  const root = doc.nodes.find((node) => node.type === 'DOCUMENT' && node.phase !== 'REMOVED');
  if (!root) {
    throw new FigmaImportError('INVALID_DOCUMENT', 'Native document has no DOCUMENT root node');
  }
  const rootId = figNodeId(root);
  if (!rootId) {
    throw new FigmaImportError('MISSING_FIELD', 'Native DOCUMENT node has no guid');
  }

  const byId = new Map<string, NormalizedNode>();
  const stack: Array<{ node: FigNode; path: string }> = [{ node: root, path: 'document' }];
  let removed = 0;
  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) break;
    const { node, path } = frame;
    const id = figNodeId(node);
    if (!id || byId.has(id)) continue;
    if (node.phase === 'REMOVED') {
      removed += 1;
      continue;
    }
    byId.set(id, adaptNativeNode(doc, node, path, report));
    const children = sortedNativeChildren(doc, id);
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child) stack.push({ node: child, path: `${path}.children[${i}]` });
    }
  }

  linkChildren(byId, (id) =>
    sortedNativeChildren(doc, id)
      .map((child) => figNodeId(child))
      .filter((childId): childId is string => childId !== null),
  );

  if (removed > 0) {
    report.warn(`Skipped ${removed} REMOVED node(s); they remain in the source message`);
  }

  const normalizedRoot = byId.get(rootId);
  return normalizedRoot ? [normalizedRoot] : [];
}

export type { BaseNode };
