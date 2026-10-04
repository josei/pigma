/**
 * Converts a normalized Figma source into the Pigma editor model
 * (`PigmaFile` from `src/model/types.ts`).
 *
 * Guarantees:
 *  - the original document hierarchy, node ids, and ordering are preserved;
 *  - every node keeps its source object verbatim in `raw`, so fields with no
 *    model home are never silently dropped;
 *  - anything that cannot be represented is recorded in the import report.
 */
import { fromMatrix, fromTRS, identity, translate } from '../../model/matrix';
import type {
  BaseNode,
  CanvasNode,
  DocumentNode,
  ComponentNode,
  ContainerNode,
  ContainerKind,
  InstanceNode,
  NodeType,
  PigmaFile,
  SceneNode,
  ShapeNode,
  ShapeType,
  StyleDefinition,
  StyleType,
  TextNode,
  TextStyle,
  Transform,
} from '../../model/types';
import { isContainer } from '../../model/types';
import type { FigDocument } from '../native/parse';
import type { FigmaRestFile } from '../rest/types';
import { adaptNativeTree, adaptRestTree, type NormalizedNode } from './adapters';
import { ReportBuilder, type FigmaImportResult } from './report';
import { mapVariableTables, type FigmaVariableTables } from './variables';

export interface ConvertOptions {
  /** Figma file key, when known. */
  fileKey?: string;
  /**
   * Variables to merge into the file. Figma's REST file JSON has no variables
   * table (they come from `/v1/files/:key/variables/local`), so callers pass that
   * payload — or any `{ variableCollections, variables }` table set — here.
   */
  variables?: unknown;
  /** Override the document name. */
  name?: string;
  /**
   * Skip Figma's hidden "Internal Only Canvas" page (component storage).
   * Default `false`: the page is imported so nothing is lost.
   */
  skipInternalCanvas?: boolean;
  /** Clock injection for tests. */
  now?: () => number;
}

interface ConvertState {
  report: ReportBuilder;
  count: number;
  /** Absolute box of the node currently being converted (parent of its children). */
  parentAbs: Box | null;
}

type Box = { x: number; y: number; width: number; height: number };

const TYPE_MAP: Record<string, NodeType> = {
  DOCUMENT: 'DOCUMENT',
  CANVAS: 'CANVAS',
  FRAME: 'FRAME',
  GROUP: 'GROUP',
  SECTION: 'SECTION',
  COMPONENT: 'COMPONENT',
  COMPONENT_SET: 'COMPONENT_SET',
  INSTANCE: 'INSTANCE',
  RECTANGLE: 'RECTANGLE',
  ROUNDED_RECTANGLE: 'RECTANGLE',
  ELLIPSE: 'ELLIPSE',
  LINE: 'LINE',
  REGULAR_POLYGON: 'POLYGON',
  POLYGON: 'POLYGON',
  STAR: 'STAR',
  VECTOR: 'VECTOR',
  TEXT: 'TEXT',
  BOOLEAN_OPERATION: 'BOOLEAN_OPERATION',
  BOOLEAN_GROUP: 'BOOLEAN_OPERATION',
  SLICE: 'SLICE',
  SYMBOL: 'COMPONENT',
};

function resolveNodeType(node: NormalizedNode, state: ConvertState, path: string): NodeType {
  if (node.type === 'FRAME' && node.groupLike) return 'GROUP';
  const mapped = TYPE_MAP[node.type];
  if (mapped) return mapped;
  const fallback: NodeType = node.children.length > 0 ? 'FRAME' : 'RECTANGLE';
  state.report.addUnsupported({
    nodeId: node.id,
    path,
    feature: `nodeType:${node.type}`,
    detail: `no Pigma equivalent; imported as ${fallback} with the original in raw`,
  });
  return fallback;
}

function resolveTransform(node: NormalizedNode, parent: Box | null, state: ConvertState): Transform {
  if (node.transform) return fromMatrix(node.transform);
  if (node.absoluteBox) {
    const tx = node.absoluteBox.x - (parent?.x ?? 0);
    const ty = node.absoluteBox.y - (parent?.y ?? 0);
    if (node.rotation) {
      state.report.warn(
        `Node ${node.id}: response has no relativeTransform; using axis-aligned bounds with ${node.rotation}° rotation (pass geometry=paths for exact transforms)`,
      );
      return fromTRS(tx, ty, node.rotation);
    }
    return translate(tx, ty);
  }
  return identity();
}

function defaultTextStyle(): TextStyle {
  return { fontFamily: 'Inter', fontSize: 12, lineHeight: { unit: 'AUTO' } };
}

function buildBase(node: NormalizedNode, type: NodeType, state: ConvertState): BaseNode {
  const base: BaseNode = {
    id: node.id,
    name: node.name,
    type,
    visible: node.visible,
    locked: node.locked,
    opacity: node.opacity,
    transform: resolveTransform(node, state.parentAbs ?? null, state),
    width: node.width,
    height: node.height,
    fills: node.fills,
    strokes: node.strokes,
    effects: node.effects,
    raw: node.raw,
  };
  if (node.blendMode) base.blendMode = node.blendMode;
  if (node.strokeWeight !== undefined) base.strokeWeight = node.strokeWeight;
  if (node.strokeAlign) base.strokeAlign = node.strokeAlign;
  if (node.strokeCap) base.strokeCap = node.strokeCap;
  if (node.strokeJoin) base.strokeJoin = node.strokeJoin;
  if (node.dashPattern) base.dashPattern = node.dashPattern;
  if (node.isMask === true) base.isMask = true;
  // Grid placement, including the wire guids carried alongside the indices.
  if (typeof node.gridColumnSpan === 'number') base.gridColumnSpan = node.gridColumnSpan;
  if (typeof node.gridRowSpan === 'number') base.gridRowSpan = node.gridRowSpan;
  if (node.gridColumnAnchorGuid) base.gridColumnAnchorGuid = node.gridColumnAnchorGuid;
  if (node.gridRowAnchorGuid) base.gridRowAnchorGuid = node.gridRowAnchorGuid;
  if (node.layoutAlign) base.layoutAlign = node.layoutAlign;
  if (typeof node.layoutGrow === 'number') base.layoutGrow = node.layoutGrow;
  if (node.constraints) base.constraints = node.constraints;
  if (node.interactions) base.interactions = node.interactions;
  if (node.bindings) base.boundVariables = node.bindings;
  return base;
}

function convertScene(node: NormalizedNode, parentAbs: Box | null, state: ConvertState, path: string): SceneNode {
  const type = resolveNodeType(node, state, path);
  state.count += 1;
  state.report.countType(type);
  state.parentAbs = parentAbs;
  const base = buildBase(node, type, state);
  const children = node.children.map((child, index) =>
    convertScene(child, node.absoluteBox ?? null, state, `${path}.children[${index}]`),
  );

  if (type === 'TEXT') {
    const text: TextNode = {
      ...base,
      type: 'TEXT',
      characters: node.characters ?? '',
      style: node.textStyle ?? defaultTextStyle(),
    };
    if (node.styleRuns) text.style.styleRuns = node.styleRuns;
    return text;
  }

  if (type === 'COMPONENT' || type === 'COMPONENT_SET') {
    const component: ComponentNode = { ...base, type: type as 'COMPONENT' | 'COMPONENT_SET', children };
    if (node.componentPropertyDefinitions) component.componentPropertyDefinitions = node.componentPropertyDefinitions;
    if (node.description) component.description = node.description;
    return component;
  }

  if (type === 'INSTANCE') {
    const instance: InstanceNode = { ...base, type: 'INSTANCE', children, componentId: node.componentId ?? '', componentSnapshot: null };
    if (node.componentProperties) instance.componentProperties = node.componentProperties;
    return instance;
  }

  if (isContainer(type) || children.length > 0) {
    const container: ContainerNode = { ...base, type: type as ContainerKind, children };
    if (node.autoLayout) {
      // The track guids ride alongside the tracks, so a round-tripped grid keeps them.
      const layout = { ...node.autoLayout };
      if (node.gridColumnGuids) layout.gridColumnGuids = node.gridColumnGuids;
      if (node.gridRowGuids) layout.gridRowGuids = node.gridRowGuids;
      container.autoLayout = layout;
    }
    if (node.layoutGrids && node.layoutGrids.length > 0) container.layoutGrids = node.layoutGrids;
    if (node.clipsContent !== undefined) container.clipsContent = node.clipsContent;
    if (node.overflowDirection !== undefined) container.overflowDirection = node.overflowDirection as 'NONE';
    if (node.booleanOperation !== undefined) container.booleanOperation = node.booleanOperation as 'UNION';
    return container;
  }

  const shape: ShapeNode = { ...base, type: type as ShapeType };
  if (node.cornerRadius !== undefined) shape.cornerRadius = node.cornerRadius;
  if (node.rectangleCornerRadii) shape.rectangleCornerRadii = node.rectangleCornerRadii;
  if (node.pathData !== undefined) shape.pathData = node.pathData;
  if (node.windingRule) shape.windingRule = node.windingRule;
  if (node.pointCount !== undefined) shape.pointCount = node.pointCount;
  if (node.innerRadius !== undefined) shape.innerRadius = node.innerRadius;
  return shape;
}

function convertCanvas(node: NormalizedNode, state: ConvertState, path: string): CanvasNode {
  state.count += 1;
  state.report.countType('CANVAS');
  const children = node.children.map((child, index) => convertScene(child, null, state, `${path}.children[${index}]`));
  const canvas: CanvasNode = {
    id: node.id,
    name: node.name,
    type: 'CANVAS',
    visible: node.visible,
    locked: node.locked,
    opacity: node.opacity,
    transform: identity(),
    width: node.width,
    height: node.height,
    fills: [],
    strokes: [],
    effects: [],
    children,
    raw: node.raw,
  };
  if (node.backgroundColor) canvas.backgroundColor = node.backgroundColor;
  return canvas;
}

function syntheticPage(children: NormalizedNode[], name: string): NormalizedNode {
  return {
    id: 'import:page',
    name,
    type: 'CANVAS',
    raw: {},
    visible: true,
    locked: false,
    opacity: 1,
    width: 0,
    height: 0,
    fills: [],
    strokes: [],
    effects: [],
    children,
  };
}

interface Envelope {
  name: string;
  lastModified: number;
  fileKey?: string;
  sourceKind: 'rest' | 'native';
  meta: Record<string, unknown>;
  /** Figma's file-level styles table, mapped into the model's own table. */
  styles?: Record<string, StyleDefinition>;
  /** Variable collections/variables/active modes, mapped into the model. */
  variables?: FigmaVariableTables;
}

const STYLE_TYPES: readonly StyleType[] = ['FILL', 'TEXT', 'EFFECT'];

/** Map Figma's `styles` table onto the model's first-class styles table. */
function mapStyleTable(
  raw: Record<string, { key?: string; name?: string; styleType?: string; description?: string }> | undefined,
  report: ReportBuilder,
): Record<string, StyleDefinition> | undefined {
  if (!raw) return undefined;
  const styles: Record<string, StyleDefinition> = {};
  for (const [id, entry] of Object.entries(raw)) {
    const type = entry.styleType;
    if (typeof type !== 'string' || !(STYLE_TYPES as readonly string[]).includes(type)) {
      report.addUnsupported({ nodeId: id, path: 'styles', feature: 'style:type', detail: `unsupported styleType ${JSON.stringify(type)}` });
      continue;
    }
    styles[id] = {
      key: typeof entry.key === 'string' ? entry.key : id,
      name: typeof entry.name === 'string' ? entry.name : id,
      type: type as StyleType,
      ...(typeof entry.description === 'string' ? { description: entry.description } : {}),
    };
  }
  return Object.keys(styles).length > 0 ? styles : undefined;
}

function buildFile(roots: NormalizedNode[], envelope: Envelope, report: ReportBuilder, options: ConvertOptions): FigmaImportResult {
  const docRoot = roots.find((node) => node.type === 'DOCUMENT') ?? null;
  const candidates = docRoot ? docRoot.children : roots;

  const pageNorms: NormalizedNode[] = [];
  const loose: NormalizedNode[] = [];
  for (const candidate of candidates) {
    if (candidate.type === 'CANVAS') pageNorms.push(candidate);
    else loose.push(candidate);
  }

  let pages = pageNorms;
  if (options.skipInternalCanvas) {
    pages = pageNorms.filter((page) => {
      if (page.name === 'Internal Only Canvas') {
        report.warn(`Skipped hidden page "${page.name}" (${page.id})`);
        return false;
      }
      return true;
    });
  }
  if (loose.length > 0) pages = [...pages, syntheticPage(loose, 'Imported nodes')];
  if (pages.length === 0) pages = [syntheticPage([], 'Page 1')];

  const state: ConvertState = { report, count: 0, parentAbs: null };
  const canvasNodes = pages.map((page, index) => convertCanvas(page, state, `pages[${index}]`));

  const document: DocumentNode = {
    id: docRoot?.id ?? 'import:document',
    name: docRoot?.name ?? envelope.name,
    type: 'DOCUMENT',
    visible: true,
    locked: false,
    opacity: 1,
    transform: identity(),
    width: 0,
    height: 0,
    fills: [],
    strokes: [],
    effects: [],
    children: canvasNodes,
    raw: docRoot?.raw ?? {},
  };

  const file: PigmaFile = {
    schema: 'pigma/1',
    source: { kind: 'figma', fileKey: envelope.fileKey ?? options.fileKey, importedAt: (options.now ?? Date.now)() },
    name: options.name ?? envelope.name,
    lastModified: envelope.lastModified,
    document,
    ...(envelope.styles ? { styles: envelope.styles } : {}),
    ...(envelope.variables?.variableCollections ? { variableCollections: envelope.variables.variableCollections } : {}),
    ...(envelope.variables?.variables ? { variables: envelope.variables.variables } : {}),
    ...(envelope.variables?.activeModes ? { activeModes: envelope.variables.activeModes } : {}),
    meta: { ...envelope.meta, figmaSource: envelope.sourceKind },
  };

  return { file, report: report.finish(envelope.sourceKind, pages.length, state.count) };
}

function parseLastModified(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/** Convert a parsed Figma REST source into a Pigma file. */
export function figmaRestToPigmaFile(source: FigmaRestFile, options: ConvertOptions = {}): FigmaImportResult {
  const report = new ReportBuilder();
  const roots = adaptRestTree(source, report);
  const now = (options.now ?? Date.now)();
  return buildFile(
    roots,
    {
      name: source.name,
      lastModified: parseLastModified(source.lastModified, now),
      fileKey: source.fileKey,
      sourceKind: 'rest',
      styles: mapStyleTable(source.styles, report),
      variables: mapVariableTables(options.variables ?? source.variables, report),
      meta: {
        role: source.role,
        editorType: source.editorType,
        thumbnailUrl: source.thumbnailUrl,
        version: source.version,
        schemaVersion: source.schemaVersion,
        components: source.components,
        componentSets: source.componentSets,
        styles: source.styles,
      },
    },
    report,
    options,
  );
}

/** Convert a decoded native `.fig` document into a Pigma file. */
export function figDocumentToPigmaFile(source: FigDocument, options: ConvertOptions = {}): FigmaImportResult {
  const report = new ReportBuilder();
  const roots = adaptNativeTree(source, report);
  const now = (options.now ?? Date.now)();
  const metaName = source.meta && typeof source.meta.file_name === 'string' ? source.meta.file_name : 'Untitled';
  return buildFile(
    roots,
    {
      name: metaName,
      lastModified: now,
      sourceKind: 'native',
      // Native .fig documents carry their own variable tables in the message.
      variables: mapVariableTables(options.variables ?? source.message, report),
      meta: {
        figmaFormat: source.header.prelude,
        formatVersion: source.header.version,
        fileMeta: source.meta ?? null,
        images: [...source.images.keys()],
      },
    },
    report,
    options,
  );
}

/** Convert any parsed Figma source (REST or native) into a Pigma file. */
export function toPigmaFile(source: FigmaRestFile | FigDocument, options: ConvertOptions = {}): FigmaImportResult {
  if ('kind' in source && source.kind === 'rest') return figmaRestToPigmaFile(source, options);
  return figDocumentToPigmaFile(source as FigDocument, options);
}
