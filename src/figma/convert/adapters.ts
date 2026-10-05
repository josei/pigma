/**
 * Normalizes the two supported Figma sources — REST JSON and decoded native
 * `.fig` nodes — into a single intermediate shape consumed by `convert.ts`.
 *
 * The normalizer is the only place that knows each source's field names; the
 * converter then maps one shape onto the Pigma model. `raw` always points at
 * the original source object so nothing is lost.
 */
import type {
  LayoutGrid,
  AutoLayout,
  BaseNode,
  BlendMode,
  ComponentPropertyDefinition,
  ComponentPropertyType,
  ComponentPropertyValue,
  Constraints,
  Effect,
  Paint,
  StyleDefinition,
  StyleType,
  PrototypeAction,
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
  layoutGrids?: LayoutGrid[];
  gridColumnSpan?: number;
  gridRowSpan?: number;
  gridColumnAnchorGuid?: string;
  gridRowAnchorGuid?: string;
  gridColumnGuids?: string[];
  /** The wire style guids per property; not yet resolved to table ids. */
  styleGuids?: Record<string, string>;
  gridRowGuids?: string[];
  /** The native `mask` flag, carried into the model's `isMask`. */
  isMask?: boolean;
  /** The auto-layout child fields, under their native names. */
  layoutAlign?: 'INHERIT' | 'STRETCH';
  layoutGrow?: number;
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

/**
 * Figma's component property types. SLOT is a property whose value is instance
 * content: the definition (its name and default node id) is kept here, and the
 * content itself arrives as an override of the slot frame's children, which the
 * instance sync merges rather than replaces.
 */
const COMPONENT_PROPERTY_TYPES: readonly ComponentPropertyType[] = ['VARIANT', 'BOOLEAN', 'TEXT', 'INSTANCE_SWAP', 'SLOT'];

/**
 * The wire's `ComponentPropType` is not the model's. Note `BOOL` on the wire
 * against `BOOLEAN` in the model: reading the wire's name through would drop
 * every boolean property.
 */
const MODEL_PROP_TYPES: Record<string, ComponentPropertyType> = {
  BOOL: 'BOOLEAN',
  TEXT: 'TEXT',
  VARIANT: 'VARIANT',
  INSTANCE_SWAP: 'INSTANCE_SWAP',
  SLOT: 'SLOT',
};

/** Unbox the wire's `ComponentPropValue` union into the model's default value. */
function modelPropValue(value: Record<string, unknown>): string | boolean | null {
  if (typeof value.boolValue === 'boolean') return value.boolValue;
  const text = value.textValue;
  if (isRecord(text) && typeof text.characters === 'string') return text.characters;
  if (typeof value.guidValue === 'string') return value.guidValue;
  if (typeof value.floatValue === 'number') return String(value.floatValue);
  return null;
}

/**
 * Maps the native wire's component property definitions — keyed by prop id, with
 * the NAME inside and the type in the wire's vocabulary — into the model's shape,
 * which is keyed by name. Unmappable entries are reported, never coerced.
 */
function nativeComponentPropDefs(
  nodeId: string,
  path: string,
  raw: unknown[],
  report: ReportBuilder,
): Record<string, ComponentPropertyDefinition> | undefined {
  const definitions: Record<string, ComponentPropertyDefinition> = {};
  for (const [index, entry] of raw.entries()) {
    if (!isRecord(entry)) continue;
    const propId = `#${index}`;
    if (entry.isDeleted === true) continue;
    const name = typeof entry.name === 'string' ? entry.name : null;
    if (!name) {
      report.addUnsupported({ nodeId, path, feature: 'componentPropertyDefinition', detail: `"${propId}" has no name` });
      continue;
    }
    const type = typeof entry.type === 'string' ? MODEL_PROP_TYPES[entry.type] : undefined;
    if (!type) {
      report.addUnsupported({
        nodeId,
        path,
        feature: 'componentPropertyDefinition',
        detail: `"${name}" has type ${JSON.stringify(entry.type)}, which the model has no member for`,
      });
      continue;
    }
    const initial = isRecord(entry.initialValue) ? modelPropValue(entry.initialValue) : null;
    if (initial === null) {
      report.addUnsupported({ nodeId, path, feature: 'componentPropertyDefinition', detail: `"${name}" has a default the model cannot represent` });
      continue;
    }
    definitions[name] = { type, defaultValue: initial };
  }
  return Object.keys(definitions).length > 0 ? definitions : undefined;
}

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

/**
 * The schema's `InteractionType` members as the model's trigger names.
 *
 * The native vocabulary has synonyms the model does not: the drag trigger is
 * `DRAG` (the model says `ON_DRAG`) and the hover pair is `MOUSE_IN`/`MOUSE_OUT`
 * as well as `MOUSE_ENTER`/`MOUSE_LEAVE`. A map that lists only OUR names is how
 * this class of gap keeps appearing.
 */
const NATIVE_TRIGGERS: Record<string, PrototypeInteraction['trigger']['type']> = {
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

/** The schema's `ConnectionType` members as the model's action kinds. */
const NATIVE_CONNECTIONS: Record<string, PrototypeAction['type']> = {
  INTERNAL_NODE: 'NODE',
  BACK: 'BACK',
  CLOSE: 'CLOSE',
  URL: 'URL',
};

/** A native GUID as the model's node id (the inverse of the exporter's mapping). */
const idOfGuid = (guid: unknown): string | null => {
  if (!isRecord(guid)) return null;
  const session = guid.sessionID;
  const local = guid.localID;
  return typeof session === 'number' && typeof local === 'number' ? `${session}:${local}` : null;
};

/** One native `PrototypeAction` as the model's action. */
function fromNativeAction(raw: Record<string, unknown>): PrototypeAction | null {
  const type = NATIVE_CONNECTIONS[String(raw.connectionType)];
  if (!type) return null;
  const action: PrototypeAction = { type };
  const destination = idOfGuid(raw.transitionNodeID);
  if (destination) action.destinationId = destination;
  if (typeof raw.connectionURL === 'string') action.url = raw.connectionURL;
  if (typeof raw.navigationType === 'string') action.navigation = raw.navigationType as PrototypeAction['navigation'];
  if (raw.navigationType === 'OVERLAY') action.overlay = true;
  if (isRecord(raw.overlayRelativePosition)) {
    action.overlayPosition = 'CUSTOM';
    if (typeof raw.overlayRelativePosition.x === 'number') action.overlayX = raw.overlayRelativePosition.x;
    if (typeof raw.overlayRelativePosition.y === 'number') action.overlayY = raw.overlayRelativePosition.y;
  }
  if (raw.transitionPreserveScroll === true) action.preserveScrollPosition = true;
  if (typeof raw.transitionType === 'string') {
    action.transition = {
      type: raw.transitionType,
      ...(typeof raw.transitionDuration === 'number' ? { duration: raw.transitionDuration } : {}),
      ...(typeof raw.easingType === 'string' ? { easing: raw.easingType } : {}),
    };
  }
  return action;
}

/** A node's native `prototypeInteractions` as the model's interactions. */
function fromNativeInteractions(node: FigNode): PrototypeInteraction[] | undefined {
  const raw = node.prototypeInteractions;
  if (!Array.isArray(raw)) return undefined;
  const out: PrototypeInteraction[] = [];
  for (const entry of raw.filter(isRecord)) {
    // A deleted interaction is a tombstone, not a live link.
    if (entry.isDeleted === true) continue;
    const event = isRecord(entry.event) ? entry.event : {};
    const trigger: PrototypeInteraction['trigger'] = {
      type: NATIVE_TRIGGERS[String(event.interactionType)] ?? 'ON_CLICK',
    };
    if (typeof event.interactionDuration === 'number') trigger.delay = event.interactionDuration;
    const actions = (Array.isArray(entry.actions) ? entry.actions : [])
      .filter(isRecord)
      .map(fromNativeAction)
      .filter((action): action is PrototypeAction => action !== null);
    if (actions.length > 0) out.push({ trigger, actions });
  }
  return out.length > 0 ? out : undefined;
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

  // The wire's home is `variableConsumptionMap`: a `VariableDataMap` whose entries
  // carry `variableField` (the field association) and `variableData.value.alias`
  // (the variable reference). `variableBindings` is not a schema name at all.
  const consumption = (node as FigNode & { variableConsumptionMap?: unknown }).variableConsumptionMap;
  const fromConsumption = consumptionBindings(consumption);
  const nativeBindings =
    fromConsumption ??
    normalizeBindings(
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
  if (Array.isArray(node.dashPattern)) normalized.dashPattern = node.dashPattern;
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
  if (node.mask === true) normalized.isMask = true;
  const stackAlign = node.stackCounterAlign;
  if (stackAlign === 'STRETCH') normalized.layoutAlign = 'STRETCH';
  else if (typeof stackAlign === 'string') normalized.layoutAlign = 'INHERIT';
  if (typeof node.stackChildPrimaryGrow === 'number') normalized.layoutGrow = node.stackChildPrimaryGrow;
  if (Array.isArray(node.layoutGrids)) {
    const grids = node.layoutGrids.filter(isRecord).map((grid) => ({
      // The schema splits what the model folds: axis separates COLUMNS from ROWS.
      pattern: grid.pattern === 'GRID' ? ('GRID' as const) : grid.axis === 'X' ? ('COLUMNS' as const) : ('ROWS' as const),
      sectionSize: typeof grid.sectionSize === 'number' ? grid.sectionSize : 0,
      ...(typeof grid.numSections === 'number' ? { count: grid.numSections } : {}),
      ...(typeof grid.gutterSize === 'number' ? { gutterSize: grid.gutterSize } : {}),
      ...(typeof grid.offset === 'number' ? { offset: grid.offset } : {}),
      ...(typeof grid.type === 'string' ? { alignment: grid.type as 'MIN' } : {}),
      ...(isRecord(grid.color) ? { color: grid.color as never } : {}),
      visible: grid.visible !== false,
    }));
    if (grids.length > 0) normalized.layoutGrids = grids;
  }
  const interactions = fromNativeInteractions(node);
  if (interactions) normalized.interactions = interactions;
  // Grid: the tracks arrive as a GUIDPositionMap, our tracks are numeric, so the
  // guids are carried alongside (and the anchors as child guids).
  const gridGuids = (value: unknown): string[] | undefined => {
    if (!isRecord(value) || !Array.isArray(value.entries)) return undefined;
    const guids = value.entries
      .filter(isRecord)
      .map((entry) => idOfGuid(entry.id))
      .filter((id): id is string => id !== null);
    return guids.length > 0 ? guids : undefined;
  };
  if (typeof node.gridColumnSpan === 'number') normalized.gridColumnSpan = node.gridColumnSpan;
  if (typeof node.gridRowSpan === 'number') normalized.gridRowSpan = node.gridRowSpan;
  const columnAnchor = idOfGuid(node.gridColumnAnchor);
  if (columnAnchor) normalized.gridColumnAnchorGuid = columnAnchor;
  const rowAnchor = idOfGuid(node.gridRowAnchor);
  if (rowAnchor) normalized.gridRowAnchorGuid = rowAnchor;
  const columnGuids = gridGuids(node.gridColumns);
  const rowGuids = gridGuids(node.gridRows);
  if (columnGuids) normalized.gridColumnGuids = columnGuids;
  if (rowGuids) normalized.gridRowGuids = rowGuids;
  // Style bindings: the wire carries `StyleId { guid }` per property. The model
  // binds by style id, so the guid is matched against the file's style table.
  // `styleID` (legacy single style) and the `inherit*StyleID` family are NOT
  // read: they are different concepts, not the node's per-property bindings.
  const styleBindings: Record<string, string> = {};
  for (const [field, property] of [
    ['styleIdForFill', 'fill'],
    ['styleIdForStrokeFill', 'stroke'],
    ['styleIdForText', 'text'],
    ['styleIdForEffect', 'effect'],
    ['styleIdForGrid', 'grid'],
  ] as const) {
    const id = idOfGuid(isRecord(node[field]) ? (node[field] as Record<string, unknown>).guid : null);
    if (id) styleBindings[property] = id;
  }
  if (Object.keys(styleBindings).length > 0) normalized.styleGuids = styleBindings;
  const autoLayout = mapNativeAutoLayout(node, ctx);
  if (autoLayout) normalized.autoLayout = autoLayout;
  if (typeof node.clipsContent === 'boolean') normalized.clipsContent = node.clipsContent;
  // The wire's name is `scrollDirection` and its values are the SHORT forms; the
  // model keeps the REST vocabulary, so the values are translated on the way in.
  const scrollDirection = typeof node.scrollDirection === 'string' ? node.scrollDirection : null;
  if (scrollDirection) {
    normalized.overflowDirection = MODEL_SCROLL_DIRECTIONS[scrollDirection] ?? scrollDirection;
  } else if (typeof node.overflowDirection === 'string') {
    normalized.overflowDirection = node.overflowDirection;
  }
  if (typeof node.booleanOperation === 'string') normalized.booleanOperation = node.booleanOperation;
  // `frameMaskDisabled: false` means the frame clips (the default).
  if (typeof node.frameMaskDisabled === 'boolean') normalized.clipsContent = !node.frameMaskDisabled;
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
    // The native wire keys the definitions by PROP ID with the name inside; the
    // REST shape keys them by name. Try the native name first.
    // A LIST on the wire, with the name inside each entry.
    const nativeDefs = node.componentPropDefs;
    if (Array.isArray(nativeDefs)) {
      const mapped = nativeComponentPropDefs(id, path, nativeDefs as unknown[], report);
      if (mapped) normalized.componentPropertyDefinitions = mapped;
    } else {
      const definitions = node.componentPropertyDefinitions;
      if (definitions && typeof definitions === 'object') {
        normalized.componentPropertyDefinitions = componentPropertyDefinitions(id, path, definitions as Record<string, unknown>, report);
      }
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
/**
 * A style entry's payload IS the normal node fields: `fillPaints` for a FILL
 * style, `layoutGrids` for a GRID style, `effects` for an EFFECT style. The model
 * carries paints/text/effects; a GRID style's `layoutGrids` has no model field, so
 * it is reported rather than dropped in silence.
 */
/** A TEXT style's payload, read back from the wire's node-style field names. */
function nativeTextStyle(raw: Record<string, unknown>): TextStyle | null {
  const fontName = isRecord(raw.fontName) ? raw.fontName : null;
  const fontSize = typeof raw.fontSize === 'number' ? raw.fontSize : undefined;
  const family = fontName && typeof fontName.family === 'string' ? fontName.family : undefined;
  if (!family && fontSize === undefined) return null;
  const style: TextStyle = { fontFamily: family ?? 'Inter', fontSize: fontSize ?? 12 };
  const fontStyle = fontName && typeof fontName.style === 'string' ? fontName.style : undefined;
  if (fontStyle) style.fontStyle = fontStyle;
  const lineHeight = isRecord(raw.lineHeight) ? raw.lineHeight : null;
  if (lineHeight && typeof lineHeight.value === 'number') {
    const units = typeof lineHeight.units === 'string' ? lineHeight.units : 'RAW';
    style.lineHeight = { unit: units === 'PERCENT' ? 'PERCENT' : units === 'PIXELS' ? 'PIXELS' : 'AUTO', value: lineHeight.value };
  }
  const letterSpacing = isRecord(raw.letterSpacing) ? raw.letterSpacing : null;
  if (letterSpacing && typeof letterSpacing.value === 'number') {
    style.letterSpacing = { unit: letterSpacing.units === 'PERCENT' ? 'PERCENT' : 'PIXELS', value: letterSpacing.value };
  }
  if (typeof raw.textCase === 'string') style.textCase = raw.textCase as TextStyle['textCase'];
  if (typeof raw.textDecoration === 'string') style.textDecoration = raw.textDecoration as TextStyle['textDecoration'];
  return style;
}

/** The wire's `ScrollDirection` -> the model's `OverflowDirection`. */
const MODEL_SCROLL_DIRECTIONS: Record<string, string> = {
  HORIZONTAL: 'HORIZONTAL_SCROLLING',
  VERTICAL: 'VERTICAL_SCROLLING',
  BOTH: 'HORIZONTAL_AND_VERTICAL_SCROLLING',
};

/** The wire's `VariableField` -> the model's binding property. */
const VARIABLE_FIELD_PROPERTIES: Record<string, string> = {
  OPACITY: 'opacity',
  CORNER_RADIUS: 'cornerRadius',
  VISIBLE: 'visible',
  // `characters` has no member spelled that way; the wire calls it TEXT_DATA.
  TEXT_DATA: 'characters',
};

/**
 * Read `variableConsumptionMap.entries` into the model's `Record<field,
 * variableId>`. An entry whose `variableField` has no model property is skipped:
 * the enum has 55 members and the model binds six properties.
 */
function consumptionBindings(raw: unknown): Record<string, string> | null {
  if (!isRecord(raw)) return null;
  const entries = raw.entries;
  if (!Array.isArray(entries)) return null;
  const out: Record<string, string> = {};
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const field = typeof entry.variableField === 'string' ? VARIABLE_FIELD_PROPERTIES[entry.variableField] : undefined;
    if (!field) continue;
    const data = isRecord(entry.variableData) ? entry.variableData : null;
    const value = data && isRecord(data.value) ? data.value : null;
    const alias = value && isRecord(value.alias) ? value.alias : null;
    const guid = alias && isRecord(alias.guid) ? alias.guid : null;
    if (!guid || typeof guid.sessionID !== 'number' || typeof guid.localID !== 'number') continue;
    out[field] = `${guid.sessionID}:${guid.localID}`;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function nativeStyleDefinition(node: FigNode): StyleDefinition | null {
  const raw = node as Record<string, unknown>;
  const type = typeof raw.styleType === 'string' ? (raw.styleType as StyleType) : null;
  if (!type) return null;
  const id = figNodeId(node);
  const name = typeof raw.name === 'string' ? raw.name : (id ?? 'Style');
  const definition: StyleDefinition = {
    key: id ?? name,
    name,
    type,
    guid: id ?? undefined,
  };
  const fills = raw.fillPaints;
  if (Array.isArray(fills) && fills.length > 0) definition.paints = fills as Paint[];
  const effects = raw.effects;
  if (Array.isArray(effects) && effects.length > 0) definition.effects = effects as Effect[];
  // A TEXT style's payload is the SAME field names a text node carries (the six
  // open-pencil corroborates): fontSize, fontName, lineHeight, letterSpacing,
  // textDecoration, textCase.
  if (type === 'TEXT') {
    const text = nativeTextStyle(raw);
    if (text) definition.text = text;
  }
  // A GRID style's payload. OBSERVED on hellomate.fig, and the model now has the
  // GRID type and a `layoutGrids` field to hold it.
  const grids = raw.layoutGrids;
  if (Array.isArray(grids) && grids.length > 0) definition.layoutGrids = grids as LayoutGrid[];
  return definition;
}

export function adaptNativeTree(
  doc: FigDocument,
  report: ReportBuilder,
): { roots: NormalizedNode[]; styles: Record<string, StyleDefinition> } {
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
  // THE ONE STYLE FILTER. A style on the wire is a NODE ENTRY with `styleType` set
  // (FILL entries are ROUNDED_RECTANGLE swatches, GRID entries are FRAMEs, and
  // they live on the hidden "Internal Only Canvas"). Recognising them HERE means a
  // style never enters the tree at all: no layers panel, no hit testing, no
  // z-order, no MCP enumeration, no export — one filter at the boundary instead of
  // six places downstream.
  const styles: Record<string, StyleDefinition> = {};
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
    if (typeof node.styleType === 'string' && node.styleType !== 'NONE') {
      const style = nativeStyleDefinition(node);
      if (style) styles[id] = style;
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
  return { roots: normalizedRoot ? [normalizedRoot] : [], styles };
}

export type { BaseNode };
