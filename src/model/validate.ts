import type {
  AutoLayout,
  LayoutGrid,
  CanvasNode,
  ColorStop,
  ContainerNode,
  Constraints,
  DevStatus,
  DocumentNode,
  Effect,
  GridTrackSize,
  Paint,
  PigmaFile,
  RGB,
  RGBA,
  SceneNode,
  TextNode,
  TextStyle,
  Transform,
  Node,
  NodeType,
} from './types';
import { isContainer } from './types';
import { isRecord } from './guards';
import { IDENTITY, fromMatrix } from './matrix';
import { hexToRgba } from './paint';
import { bumpSession, nextNodeId } from './ids';

export interface ValidationResult {
  ok: boolean;
  file: PigmaFile | null;
  errors: string[];
  warnings: string[];
}

const BASE_KEYS = [
  'id',
  'name',
  'type',
  'visible',
  'locked',
  'opacity',
  'blendMode',
  'transform',
  'width',
  'height',
  'fills',
  'strokes',
  'strokeWeight',
  'strokeAlign',
  'strokeCap',
  'strokeJoin',
  'dashPattern',
  'effects',
  'constraints',
  'layoutAlign',
  'layoutGrow',
  'gridColumnAnchorIndex',
  'gridRowAnchorIndex',
  'gridColumnAnchorGuid',
  'gridRowAnchorGuid',
  'gridColumnSpan',
  'gridRowSpan',
  'interactions',
  'styles',
  'boundVariables',
  'raw',
  'children',
  'autoLayout',
  'layoutGrids',
  'overflowDirection',
  'booleanOperation',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'clipsContent',
  'cornerRadius',
  'rectangleCornerRadii',
  'pathData',
  'windingRule',
  'pointCount',
  'devStatus',
  'isMask',
  'innerRadius',
  'characters',
  'style',
  'componentId',
  'libraryId',
  'libraryKey',
  'libraryVersion',
  'componentProperties',
  'overrides',
  'componentSnapshot',
  'componentPropertyDefinitions',
  'description',
  'backgroundColor',
  'prototypeStartNodeId',
  'flows',
] as const;

const KNOWN_KEYS = new Set<string>(BASE_KEYS);

type Json = Record<string, unknown>;

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeColor(value: unknown): RGBA {
  if (!isRecord(value)) return { r: 0, g: 0, b: 0, a: 1 };
  const channel = (v: unknown) => Math.min(1, Math.max(0, num(v, 0)));
  const out: RGBA = { r: channel(value.r), g: channel(value.g), b: channel(value.b) };
  if (typeof value.a === 'number') out.a = Math.min(1, Math.max(0, value.a));
  return out;
}

function normalizeTransform(value: unknown): Transform {
  if (Array.isArray(value) && value.length === 2) {
    try {
      return fromMatrix(value as number[][]);
    } catch {
      return { ...IDENTITY };
    }
  }
  if (isRecord(value)) {
    return {
      a: num(value.a, 1),
      b: num(value.b, 0),
      c: num(value.c, 0),
      d: num(value.d, 1),
      tx: num(value.tx, 0),
      ty: num(value.ty, 0),
    };
  }
  return { ...IDENTITY };
}

function normalizeStops(value: unknown): ColorStop[] {
  if (!Array.isArray(value)) return [];
  const stops = value.filter(isRecord).map((stop) => ({
    position: num(stop.position, 0),
    color: normalizeColor(stop.color),
  }));
  return stops.length > 0 ? stops : [{ position: 0, color: { r: 0, g: 0, b: 0, a: 1 } }];
}

const PAINT_TYPES = new Set<string>([
  'SOLID',
  'GRADIENT_LINEAR',
  'GRADIENT_RADIAL',
  'GRADIENT_ANGULAR',
  'GRADIENT_DIAMOND',
  'IMAGE',
  'VIDEO',
  'PATTERN',
]);

function normalizePaint(value: unknown): Paint | null {
  if (!isRecord(value)) return null;
  const type = str(value.type, 'SOLID');
  const shared: Record<string, unknown> = {};
  if (typeof value.opacity === 'number') shared.opacity = Math.min(1, Math.max(0, value.opacity));
  if (typeof value.visible === 'boolean') shared.visible = value.visible;
  if (typeof value.blendMode === 'string') shared.blendMode = value.blendMode;
  if (isRecord(value.boundVariables)) shared.boundVariables = value.boundVariables;

  if (!PAINT_TYPES.has(type)) {
    // Unknown paint kinds keep their raw fields; the model only types the known ones.
    return { ...value, type, ...shared } as unknown as Paint;
  }
  switch (type) {
    case 'SOLID':
      return { type: 'SOLID', color: normalizeColor(value.color) as RGB, ...shared } as Paint;
    case 'GRADIENT_LINEAR':
    case 'GRADIENT_RADIAL':
    case 'GRADIENT_ANGULAR':
    case 'GRADIENT_DIAMOND':
      return {
        type,
        gradientStops: normalizeStops(value.gradientStops),
        ...(Array.isArray(value.gradientTransform) ? { gradientTransform: value.gradientTransform as never } : {}),
        ...shared,
      } as Paint;
    case 'IMAGE':
      return {
        type: 'IMAGE',
        ...(typeof value.imageRef === 'string' ? { imageRef: value.imageRef } : {}),
        ...(typeof value.dataUrl === 'string' ? { dataUrl: value.dataUrl } : {}),
        ...(typeof value.scaleMode === 'string' ? { scaleMode: value.scaleMode as 'FILL' } : {}),
        ...(Array.isArray(value.imageTransform) ? { imageTransform: value.imageTransform as never } : {}),
        ...(typeof value.scalingFactor === 'number' ? { scalingFactor: value.scalingFactor } : {}),
        // The bitmap's natural size: TILE repeats the image at this size.
        ...(typeof value.naturalWidth === 'number' && value.naturalWidth > 0 ? { naturalWidth: value.naturalWidth } : {}),
        ...(typeof value.naturalHeight === 'number' && value.naturalHeight > 0 ? { naturalHeight: value.naturalHeight } : {}),
        ...shared,
      } as Paint;
    default:
      return { ...value, type, ...shared } as unknown as Paint;
  }
}

const EFFECT_TYPES = new Set<string>(['DROP_SHADOW', 'INNER_SHADOW', 'LAYER_BLUR', 'BACKGROUND_BLUR']);

function normalizeEffect(value: unknown): Effect | null {
  if (!isRecord(value)) return null;
  const type = str(value.type, 'DROP_SHADOW');
  const visible = typeof value.visible === 'boolean' ? value.visible : undefined;
  if (!EFFECT_TYPES.has(type)) {
    // Unknown effect kinds keep their raw fields; the model types them as UNKNOWN.
    return { ...value, type: 'UNKNOWN', ...(visible !== undefined ? { visible } : {}) } as Effect;
  }
  if (type === 'LAYER_BLUR' || type === 'BACKGROUND_BLUR') {
    return { type, radius: num(value.radius, 0), ...(visible !== undefined ? { visible } : {}) };
  }
  const offset = isRecord(value.offset) ? { x: num(value.offset.x, 0), y: num(value.offset.y, 0) } : { x: 0, y: 0 };
  return {
    type,
    color: normalizeColor(value.color),
    offset,
    radius: num(value.radius, 0),
    ...(typeof value.spread === 'number' ? { spread: value.spread } : {}),
    ...(typeof value.showShadowBehindNode === 'boolean' ? { showShadowBehindNode: value.showShadowBehindNode } : {}),
    ...(typeof value.blendMode === 'string' ? { blendMode: value.blendMode as never } : {}),
    ...(visible !== undefined ? { visible } : {}),
  } as Effect;
}

const CONSTRAINTS: ReadonlySet<string> = new Set(['MIN', 'CENTER', 'MAX', 'STRETCH', 'SCALE']);

function normalizeConstraints(value: unknown): Constraints | undefined {
  if (!isRecord(value)) return undefined;
  const pick = (v: unknown) => (typeof v === 'string' && CONSTRAINTS.has(v) ? (v as Constraints['horizontal']) : 'MIN');
  return { horizontal: pick(value.horizontal), vertical: pick(value.vertical) };
}

function normalizeTextStyle(value: unknown): TextStyle {
  const style = isRecord(value) ? value : {};
  const lineHeight = isRecord(style.lineHeight)
    ? { unit: str(style.lineHeight.unit, 'PERCENT') as 'PERCENT', value: num(style.lineHeight.value, 120) }
    : { unit: 'PERCENT' as const, value: 120 };
  const letterSpacing = isRecord(style.letterSpacing)
    ? { unit: str(style.letterSpacing.unit, 'PERCENT') as 'PERCENT', value: num(style.letterSpacing.value, 0) }
    : { unit: 'PERCENT' as const, value: 0 };
  return {
    fontFamily: str(style.fontFamily, 'Inter'),
    ...(typeof style.fontStyle === 'string' ? { fontStyle: style.fontStyle } : {}),
    ...(typeof style.fontWeight === 'number' ? { fontWeight: style.fontWeight } : {}),
    fontSize: num(style.fontSize, 14),
    lineHeight,
    letterSpacing,
    ...(typeof style.textAlignHorizontal === 'string' ? { textAlignHorizontal: style.textAlignHorizontal as 'LEFT' } : {}),
    ...(typeof style.textAlignVertical === 'string' ? { textAlignVertical: style.textAlignVertical as 'TOP' } : {}),
    ...(typeof style.textCase === 'string' ? { textCase: style.textCase as 'ORIGINAL' } : {}),
    ...(typeof style.textDecoration === 'string' ? { textDecoration: style.textDecoration as 'NONE' } : {}),
    ...(typeof style.textAutoResize === 'string' ? { textAutoResize: style.textAutoResize as 'NONE' } : {}),
    ...(typeof style.paragraphSpacing === 'number' ? { paragraphSpacing: style.paragraphSpacing } : {}),
    ...(Array.isArray(style.styleRuns) ? { styleRuns: style.styleRuns } : {}),
  };
}

const GRID_PATTERNS: ReadonlySet<string> = new Set(['COLUMNS', 'ROWS', 'GRID']);

function normalizeLayoutGrids(value: unknown): LayoutGrid[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const grids = value.filter(isRecord).map((grid) => ({
    pattern: (typeof grid.pattern === 'string' && GRID_PATTERNS.has(grid.pattern) ? grid.pattern : 'COLUMNS') as LayoutGrid['pattern'],
    sectionSize: num(grid.sectionSize, 80),
    ...(typeof grid.count === 'number' ? { count: grid.count } : {}),
    ...(typeof grid.gutterSize === 'number' ? { gutterSize: grid.gutterSize } : {}),
    ...(typeof grid.offset === 'number' ? { offset: grid.offset } : {}),
    ...(typeof grid.alignment === 'string' ? { alignment: grid.alignment as 'MIN' } : {}),
    ...(isRecord(grid.color) ? { color: normalizeColor(grid.color) } : {}),
    ...(typeof grid.visible === 'boolean' ? { visible: grid.visible } : {}),
  }));
  return grids.length > 0 ? grids : undefined;
}

/** A grid track list in Figma's shape; anything malformed is dropped. */
/** A non-negative whole number, or false. */
function wholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function normalizeTracks(value: unknown): GridTrackSize[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tracks = value
    .filter(isRecord)
    .map((track) => ({
      type: track.type === 'FIXED' ? ('FIXED' as const) : ('FLEX' as const),
      value: typeof track.value === 'number' && Number.isFinite(track.value) && track.value > 0 ? track.value : 1,
    }));
  return tracks.length > 0 ? tracks : undefined;
}

function normalizeAutoLayout(value: unknown): AutoLayout | undefined {
  if (!isRecord(value)) return undefined;
  const layout = { layoutMode: str(value.layoutMode, 'NONE') as AutoLayout['layoutMode'], ...value } as AutoLayout;
  // Grid tracks are kept only when they are well formed: the layout pass trusts
  // them, so a malformed list is dropped rather than carried into geometry.
  const columns = normalizeTracks(value.gridColumns);
  const rows = normalizeTracks(value.gridRows);
  if (columns) layout.gridColumns = columns;
  else delete layout.gridColumns;
  if (rows) layout.gridRows = rows;
  else delete layout.gridRows;
  return layout;
}

function normalizeInteractions(value: unknown): Node['interactions'] {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter(isRecord).map((item) => ({
    trigger: isRecord(item.trigger)
      ? { type: str(item.trigger.type, 'ON_CLICK') as 'ON_CLICK', ...item.trigger }
      : { type: 'ON_CLICK' as const },
    actions: Array.isArray(item.actions) ? (item.actions.filter(isRecord) as never[]) : [],
  }));
  return out as Node['interactions'];
}

function collectExtras(source: Json, warnings: string[], nodeId: string): Record<string, unknown> | undefined {
  const extras: Record<string, unknown> = {};
  let count = 0;
  for (const key of Object.keys(source)) {
    if (KNOWN_KEYS.has(key)) continue;
    extras[key] = source[key];
    count += 1;
  }
  if (isRecord(source.raw)) {
    Object.assign(extras, source.raw);
  }
  if (count > 0) warnings.push(`node ${nodeId}: preserved ${count} unrecognized field(s) in raw`);
  return Object.keys(extras).length > 0 ? extras : undefined;
}

function normalizeNode(value: unknown, warnings: string[], path: string): SceneNode | null {
  if (!isRecord(value)) {
    warnings.push(`${path}: skipped non-object node`);
    return null;
  }
  const type = str(value.type, '') as NodeType;
  if (!type) {
    warnings.push(`${path}: skipped node without type`);
    return null;
  }
  const id = str(value.id, '');
  if (!id) {
    warnings.push(`${path}: node without id was given a generated id`);
  }
  const nodeId = id || nextNodeId();
  const fills = Array.isArray(value.fills) ? value.fills.map(normalizePaint).filter((p): p is Paint => !!p) : [];
  const strokes = Array.isArray(value.strokes) ? value.strokes.map(normalizePaint).filter((p): p is Paint => !!p) : [];
  const effects = Array.isArray(value.effects) ? value.effects.map(normalizeEffect).filter((e): e is Effect => !!e) : [];
  const raw = collectExtras(value, warnings, nodeId);

  const base = {
    id: nodeId,
    name: str(value.name, type),
    type,
    visible: bool(value.visible, true),
    locked: bool(value.locked, false),
    opacity: Math.min(1, Math.max(0, num(value.opacity, 1))),
    ...(typeof value.blendMode === 'string' ? { blendMode: value.blendMode as never } : {}),
    ...(value.devStatus === 'READY_FOR_DEVELOPMENT' || value.devStatus === 'COMPLETED'
      ? { devStatus: value.devStatus as DevStatus }
      : {}),
    ...(value.isMask === true ? { isMask: true } : {}),
    // Grid placement (Figma's terms). Kept only when they are whole numbers, so
    // the layout pass never sees a fractional track index.
    ...(wholeNumber(value.gridColumnAnchorIndex) ? { gridColumnAnchorIndex: value.gridColumnAnchorIndex } : {}),
    ...(wholeNumber(value.gridRowAnchorIndex) ? { gridRowAnchorIndex: value.gridRowAnchorIndex } : {}),
    ...(wholeNumber(value.gridColumnSpan) ? { gridColumnSpan: value.gridColumnSpan } : {}),
    ...(wholeNumber(value.gridRowSpan) ? { gridRowSpan: value.gridRowSpan } : {}),
    transform: normalizeTransform(value.transform),
    width: Math.max(0, num(value.width, 0)),
    height: Math.max(0, num(value.height, 0)),
    fills,
    strokes,
    ...(typeof value.strokeWeight === 'number' ? { strokeWeight: value.strokeWeight } : {}),
    ...(typeof value.strokeAlign === 'string' ? { strokeAlign: value.strokeAlign as 'INSIDE' } : {}),
    ...(typeof value.strokeCap === 'string' ? { strokeCap: value.strokeCap as 'NONE' } : {}),
    ...(typeof value.strokeJoin === 'string' ? { strokeJoin: value.strokeJoin as 'MITER' } : {}),
    ...(Array.isArray(value.dashPattern) ? { dashPattern: value.dashPattern.filter((n) => typeof n === 'number') as number[] } : {}),
    ...(typeof value.minWidth === 'number' ? { minWidth: value.minWidth } : {}),
    ...(typeof value.minHeight === 'number' ? { minHeight: value.minHeight } : {}),
    ...(typeof value.maxWidth === 'number' ? { maxWidth: value.maxWidth } : {}),
    ...(typeof value.maxHeight === 'number' ? { maxHeight: value.maxHeight } : {}),
    ...(effects.length > 0 ? { effects } : {}),
    ...(normalizeConstraints(value.constraints) ? { constraints: normalizeConstraints(value.constraints) } : {}),
    ...(typeof value.layoutAlign === 'string' ? { layoutAlign: value.layoutAlign as 'INHERIT' } : {}),
    ...(typeof value.layoutGrow === 'number' ? { layoutGrow: value.layoutGrow } : {}),
    ...(normalizeInteractions(value.interactions) ? { interactions: normalizeInteractions(value.interactions) } : {}),
    ...(isRecord(value.styles) ? { styles: value.styles as never } : {}),
    ...(isRecord(value.boundVariables) ? { boundVariables: value.boundVariables as never } : {}),
    // Component property values and their bindings are generic node fields: an
    // instance's values and a layer's references were silently dropped on load,
    // which lost an INSTANCE_SWAP choice across a save.
    ...(isRecord(value.componentPropertyReferences) ? { componentPropertyReferences: value.componentPropertyReferences as never } : {}),
    ...(isRecord(value.componentProperties) ? { componentProperties: value.componentProperties as never } : {}),
    ...(raw ? { raw } : {}),
  };

  const children = Array.isArray(value.children)
    ? (value.children
        .map((child, index) => normalizeNode(child, warnings, `${path}/${nodeId}/child[${index}]`))
        .filter((c): c is SceneNode => !!c))
    : [];

  switch (type) {
    case 'TEXT': {
      const text: TextNode = {
        ...(base as unknown as TextNode),
        type: 'TEXT',
        characters: str(value.characters, ''),
        style: normalizeTextStyle(value.style),
      };
      return text;
    }
    case 'INSTANCE': {
      const instance = {
        ...base,
        type: 'INSTANCE' as const,
        children,
        componentId: str(value.componentId, ''),
        // Library links must survive a reload, or staleness cannot be computed.
        ...(typeof value.libraryId === 'string' ? { libraryId: value.libraryId } : {}),
        ...(typeof value.libraryKey === 'string' ? { libraryKey: value.libraryKey } : {}),
        ...(typeof value.libraryVersion === 'number' ? { libraryVersion: value.libraryVersion } : {}),
        ...(isRecord(value.overrides) ? { overrides: value.overrides as never } : {}),
        ...(isRecord(value.componentSnapshot) ? { componentSnapshot: normalizeNode(value.componentSnapshot, warnings, `${path}/snapshot`) } : {}),
      };
      if (!instance.componentId) warnings.push(`${path}: INSTANCE ${nodeId} has no componentId`);
      return instance;
    }
    case 'COMPONENT':
    case 'COMPONENT_SET': {
      return {
        ...base,
        type,
        children,
        ...(isRecord(value.componentPropertyDefinitions) ? { componentPropertyDefinitions: value.componentPropertyDefinitions } : {}),
        ...(typeof value.description === 'string' ? { description: value.description } : {}),
      } as SceneNode;
    }
    default: {
      if (isContainer(type) || type === 'GROUP' || type === 'SECTION' || type === 'BOOLEAN_OPERATION') {
        const container: ContainerNode = {
          ...base,
          // BOOLEAN_OPERATION containers carry their own pathData.
          ...(typeof value.pathData === 'string' ? { pathData: value.pathData } : {}),
          ...(typeof value.windingRule === 'string' ? { windingRule: value.windingRule as 'NONZERO' } : {}),
          ...(typeof value.cornerRadius === 'number' ? { cornerRadius: value.cornerRadius } : {}),
          children,
          ...(normalizeAutoLayout(value.autoLayout) ? { autoLayout: normalizeAutoLayout(value.autoLayout) } : {}),
          ...(normalizeLayoutGrids(value.layoutGrids) ? { layoutGrids: normalizeLayoutGrids(value.layoutGrids) } : {}),
          ...(typeof value.clipsContent === 'boolean' ? { clipsContent: value.clipsContent } : {}),
          ...(typeof value.overflowDirection === 'string' ? { overflowDirection: value.overflowDirection as 'NONE' } : {}),
          ...(typeof value.booleanOperation === 'string' ? { booleanOperation: value.booleanOperation as 'UNION' } : {}),
        } as ContainerNode;
        return container;
      }
      const shape = {
        ...base,
        ...(typeof value.cornerRadius === 'number' ? { cornerRadius: value.cornerRadius } : {}),
        ...(Array.isArray(value.rectangleCornerRadii) && value.rectangleCornerRadii.length === 4
          ? { rectangleCornerRadii: value.rectangleCornerRadii.map((n) => num(n, 0)) as [number, number, number, number] }
          : {}),
        ...(typeof value.pathData === 'string' ? { pathData: value.pathData } : {}),
        ...(typeof value.windingRule === 'string' ? { windingRule: value.windingRule as 'NONZERO' } : {}),
        ...(typeof value.pointCount === 'number' ? { pointCount: value.pointCount } : {}),
        ...(typeof value.innerRadius === 'number' ? { innerRadius: value.innerRadius } : {}),
      };
      return shape as SceneNode;
    }
  }
}

function normalizeCanvas(value: unknown, warnings: string[], index: number): CanvasNode | null {
  if (!isRecord(value)) return null;
  if (value.type !== 'CANVAS') {
    warnings.push(`document.children[${index}] is not a CANVAS node (got ${String(value.type)}); skipped`);
    return null;
  }
  const node = normalizeNode(value, warnings, `document.children[${index}]`);
  if (!node) return null;
  const canvas = node as unknown as CanvasNode;
  return {
    ...canvas,
    type: 'CANVAS',
    children: Array.isArray(value.children)
      ? (value.children
          .map((child, i) => normalizeNode(child, warnings, `page/${canvas.id}/child[${i}]`))
          .filter((c): c is SceneNode => !!c))
      : [],
    ...(isRecord(value.backgroundColor) ? { backgroundColor: normalizeColor(value.backgroundColor) } : {}),
    ...(typeof value.prototypeStartNodeId === 'string' || value.prototypeStartNodeId === null
      ? { prototypeStartNodeId: value.prototypeStartNodeId as string | null }
      : {}),
    ...(Array.isArray(value.flows)
      ? { flows: value.flows.filter(isRecord).map((flow) => ({
          id: str(flow.id, ''),
          name: str(flow.name, 'Flow'),
          startNodeId: str(flow.startNodeId, ''),
          ...(typeof flow.description === 'string' ? { description: flow.description } : {}),
        })).filter((flow) => flow.id !== '' && flow.startNodeId !== '') }
      : {}),
  };
}

/**
 * Lenient but strict-where-it-matters validator: unknown/extra fields are kept
 * (Figma fidelity), structural problems are reported as errors.
 */
export function validatePigmaFile(value: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, file: null, errors: ['root value is not an object'], warnings };
  }
  const document = value.document;
  if (!isRecord(document)) {
    return { ok: false, file: null, errors: ['missing "document" object'], warnings };
  }
  if (document.type !== 'DOCUMENT') {
    errors.push(`document.type must be "DOCUMENT" (got ${String(document.type)})`);
  }
  const rawChildren = document.children;
  if (!Array.isArray(rawChildren)) {
    errors.push('document.children must be an array of CANVAS pages');
  }
  if (errors.length > 0) return { ok: false, file: null, errors, warnings };

  const pages = (rawChildren as unknown[])
    .map((child, index) => normalizeCanvas(child, warnings, index))
    .filter((c): c is CanvasNode => !!c);
  if (pages.length === 0) {
    errors.push('document has no CANVAS pages');
    return { ok: false, file: null, errors, warnings };
  }

  const documentNode: DocumentNode = {
    id: str(document.id, '0:0'),
    name: str(document.name, 'Document'),
    type: 'DOCUMENT',
    visible: true,
    locked: false,
    opacity: 1,
    transform: { ...IDENTITY },
    width: 0,
    height: 0,
    fills: [],
    strokes: [],
    children: pages,
  };

  const ids: string[] = [];
  const visit = (node: Node) => {
    ids.push(node.id);
    if ('children' in node && Array.isArray(node.children)) node.children.forEach(visit);
  };
  visit(documentNode);
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) warnings.push(`duplicate node id "${id}"`);
    seen.add(id);
  }

  const file: PigmaFile = {
    schema: 'pigma/1',
    name: str(value.name, 'Untitled'),
    lastModified: num(value.lastModified, Date.now()),
    document: documentNode,
    ...(isRecord(value.source) ? { source: value.source as never } : {}),
    ...(typeof value.prototypeStartNodeId === 'string' || value.prototypeStartNodeId === null
      ? { prototypeStartNodeId: value.prototypeStartNodeId as string | null }
      : {}),
    ...(isRecord(value.meta) ? { meta: value.meta } : {}),
    ...(isRecord(value.styles) ? { styles: value.styles as never } : {}),
    ...(isRecord(value.variableCollections) ? { variableCollections: value.variableCollections as never } : {}),
    ...(isRecord(value.variables) ? { variables: value.variables as never } : {}),
    ...(isRecord(value.activeModes) ? { activeModes: value.activeModes as never } : {}),
    ...(Array.isArray(value.versions) ? { versions: value.versions.filter(isRecord) as never } : {}),
    ...(Array.isArray(value.comments) ? { comments: value.comments.filter(isRecord) as never } : {}),
    ...(isRecord(value.publishedLibrary) ? { publishedLibrary: value.publishedLibrary as never } : {}),
  };

  // Newly generated ids must not collide with imported ones.
  bumpSession(ids);
  return { ok: true, file, errors, warnings };
}

export function emptyFile(name = 'Untitled'): PigmaFile {
  const page: CanvasNode = {
    id: nextNodeId(),
    name: 'Page 1',
    type: 'CANVAS',
    visible: true,
    locked: false,
    opacity: 1,
    transform: { ...IDENTITY },
    width: 0,
    height: 0,
    fills: [],
    strokes: [],
    backgroundColor: hexToRgba('#e5e5e5'),
    children: [],
  };
  return {
    schema: 'pigma/1',
    name,
    lastModified: Date.now(),
    document: {
      id: nextNodeId(),
      name: 'Document',
      type: 'DOCUMENT',
      visible: true,
      locked: false,
      opacity: 1,
      transform: { ...IDENTITY },
      width: 0,
      height: 0,
      fills: [],
      strokes: [],
      children: [page],
    },
  };
}

