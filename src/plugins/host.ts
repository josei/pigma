/**
 * Plugin API host: the bridge between the shared plugin engine
 * (`src/plugins/engine.ts`) and the Pigma document model.
 *
 * Implements a supported subset of the Figma Plugin API against the model. The
 * engine (QuickJS/WASM) can only reach the document through these handlers —
 * there is no host filesystem, network, or process access. Anything outside the
 * subset throws an explicit unsupported error (it is never silently ignored).
 *
 * Environment-agnostic: it imports the model only, so the browser editor and the
 * Node MCP server share exactly one implementation. See `docs/MCP.md` for the
 * supported list and `docs/PLUGINS.md` for the engine API.
 */
import {
  createComponentNode,
  createEllipseNode,
  createFrameNode,
  createLineNode,
  createPolygonNode,
  createRectNode,
  createStarNode,
  createTextNode,
} from '../model/factory';
import { booleanNodes, type BooleanMode } from '../model/boolean';
import { fromTRS, rotationOf } from '../model/matrix';
import { isRecord } from '../model/guards';
import { componentPropertiesOf, componentSetOf, setInstanceProperty, setInstanceVariant } from '../model/variants';
import { createComponentSet } from '../model/variants';
import { nextNodeId } from '../model/ids';
import { findNode, insertChild, moveNode, removeNode, updateNode } from '../model/tree';
import { hasChildren } from '../model/types';
import type { AnyNode, AutoLayout, ColorStop, InstanceNode, Paint, PigmaFile, SceneNode, TextNode } from '../model/types';

const FACTORIES: Record<string, (root: AnyNode, x: number, y: number, w: number, h: number) => SceneNode> = {
  RECTANGLE: createRectNode,
  ELLIPSE: createEllipseNode,
  POLYGON: createPolygonNode,
  STAR: createStarNode,
  FRAME: createFrameNode,
  LINE: (root, x, y, w) => createLineNode(root, x, y, w),
  COMPONENT: (root, x, y, w, h) => createComponentNode(root, createFrameNode(root, x, y, w, h)),
};

const READ_ONLY = new Set(['id', 'type']);

const TEXT_ALIGN_HORIZONTAL = ['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED'] as const;
const TEXT_ALIGN_VERTICAL = ['TOP', 'CENTER', 'BOTTOM'] as const;
const TEXT_CASES = ['ORIGINAL', 'UPPER', 'LOWER', 'TITLE'] as const;
const TEXT_DECORATIONS = ['NONE', 'UNDERLINE', 'STRIKETHROUGH'] as const;

/** A TextNode, or an explicit failure — these properties are TEXT-only. */
function requireText(node: AnyNode, prop: string): TextNode {
  if (node.type !== 'TEXT') throw new Error(`${prop} is only valid on TEXT nodes`);
  return node;
}

function requirePositiveNumber(value: unknown, prop: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${prop} must be a positive number`);
  }
  return value;
}

function requireFiniteNumber(value: unknown, prop: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${prop} must be a number`);
  return value;
}

function requireOneOf<T extends string>(value: unknown, allowed: readonly T[], prop: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new Error(`${prop} must be one of ${allowed.map((entry) => `"${entry}"`).join(', ')}`);
  }
  return value as T;
}

const AUTO_LAYOUT_PROPS = [
  'layoutMode',
  'itemSpacing',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'primaryAxisSizingMode',
  'counterAxisSizingMode',
  'primaryAxisAlignItems',
  'counterAxisAlignItems',
  'layoutWrap',
  'layoutSizingHorizontal',
  'layoutSizingVertical',
] as const;

function toPaint(value: unknown): Paint {
  if (typeof value !== 'object' || value === null) throw new Error('paint must be an object');
  const paint = value as Record<string, unknown>;
  const type = paint.type;
  if (type === 'SOLID') {
    const color = (paint.color ?? {}) as { r?: number; g?: number; b?: number };
    const solid: Paint = { type: 'SOLID', color: { r: color.r ?? 0, g: color.g ?? 0, b: color.b ?? 0 } };
    if (typeof paint.opacity === 'number') solid.opacity = paint.opacity;
    if (typeof paint.visible === 'boolean') solid.visible = paint.visible;
    return solid;
  }
  if (type === 'GRADIENT_LINEAR' || type === 'GRADIENT_RADIAL' || type === 'GRADIENT_ANGULAR' || type === 'GRADIENT_DIAMOND') {
    if (!Array.isArray(paint.gradientStops)) throw new Error(`${type} requires gradientStops`);
    const gradient: Paint = { type, gradientStops: paint.gradientStops as ColorStop[] };
    if (typeof paint.opacity === 'number') gradient.opacity = paint.opacity;
    if (typeof paint.visible === 'boolean') gradient.visible = paint.visible;
    return gradient;
  }
  throw new Error(`Unsupported paint type "${String(type)}". Supported: SOLID, GRADIENT_LINEAR, GRADIENT_RADIAL, GRADIENT_ANGULAR, GRADIENT_DIAMOND.`);
}

function toPaintList(value: unknown): Paint[] {
  if (!Array.isArray(value)) throw new Error('fills/strokes must be an array');
  return value.map(toPaint);
}

export interface PluginHost {
  readonly file: PigmaFile;
  /** Full transcript, including guest `figma.notify`/log output. */
  readonly logs: string[];
  /** Recoverable degradations (converted or skipped input), also in `logs`. */
  readonly warnings: string[];
  closed: boolean;
  documentId(): string;
  pageId(): string;
  hasNode(nodeId: string): boolean;
  children(nodeId: string): string[];
  create(kind: string, args: Record<string, unknown>): string;
  createInstance(componentId: string): string;
  combineAsVariants(nodeIds: string[], parentId: string | undefined): string;
  booleanOperation(nodeIds: string[], mode: BooleanMode, parentId?: string): string;
  get(nodeId: string, prop: string): unknown;
  set(nodeId: string, prop: string, value: unknown): void;
  call(nodeId: string, method: string, args: unknown[]): unknown;
  getSelection(): string[];
  setSelection(ids: string[]): void;
  log(text: string): void;
  warn(text: string): void;
  close(): void;
}

export function createPluginHost(initial: PigmaFile): PluginHost {
  let file = initial;
  const logs: string[] = [];
  const warnings: string[] = [];
  /** Record a recoverable degradation: it is both a log line and a warning. */
  const warn = (text: string): void => {
    logs.push(text);
    warnings.push(text);
  };
  let closed = false;
  let selection: string[] = [];

  const pageId = (): string => {
    const page = file.document.children[0];
    if (!page) throw new Error('Document has no pages');
    return page.id;
  };

  const requireNode = (nodeId: string): AnyNode => {
    const node = findNode(file.document, nodeId);
    if (!node) throw new Error(`Unknown node id "${nodeId}"`);
    return node;
  };

  const create = (kind: string, args: Record<string, unknown>): string => {
    const num = (key: string, fallback: number): number => (typeof args[key] === 'number' ? (args[key] as number) : fallback);
    const x = num('x', 0);
    const y = num('y', 0);
    const width = num('width', 100);
    const height = num('height', 100);
    let node: SceneNode;
    if (kind === 'TEXT') {
      node = createTextNode(file.document, x, y, typeof args.characters === 'string' ? args.characters : 'Text');
    } else if (kind === 'VECTOR') {
      // A VECTOR is a shape node; start from a rectangle and re-type it.
      node = { ...createRectNode(file.document, x, y, width, height), type: 'VECTOR', fills: [], pathData: '' };
    } else {
      const factory = FACTORIES[kind];
      if (!factory) {
        throw new Error(
          `Unsupported node kind "${kind}". Supported: FRAME, RECTANGLE, ELLIPSE, LINE, POLYGON, STAR, TEXT, VECTOR, COMPONENT.`,
        );
      }
      node = factory(file.document, x, y, width, height);
    }
    if (typeof args.name === 'string') node.name = args.name;
    const parentId = typeof args.parentId === 'string' ? args.parentId : pageId();
    // Refuse an unknown parent instead of silently dropping the node: `insertChild`
    // is a no-op when the parent is missing, so the script would otherwise get an
    // id for a node that is not in the document.
    const parent = findNode(file.document, parentId);
    if (!parent) throw new Error(`Unknown parent id "${parentId}": the node was not created.`);
    if (parent.type === 'DOCUMENT' || !hasChildren(parent)) {
      throw new Error(`"${parentId}" (${parent.type}) cannot contain children: the node was not created.`);
    }
    file = { ...file, document: insertChild(file.document, parentId, node), lastModified: Date.now() };
    return node.id;
  };

  const combineAsVariants = (nodeIds: string[], parentId: string | undefined): string => {
    if (nodeIds.length === 0) throw new Error('combineAsVariants requires at least one node');
    const nodes = nodeIds.map(requireNode);
    const notComponent = nodes.find((node) => node.type !== 'COMPONENT');
    if (notComponent) {
      throw new Error(`combineAsVariants requires COMPONENT nodes (got ${notComponent.type}). Create them with figma.createComponent.`);
    }
    // The model derives one VARIANT property per axis from the components'
    // `Property=value` names, exactly as Figma's combine-as-variants does.
    const { file: combined, setId } = createComponentSet(file, nodeIds);
    if (!setId) throw new Error('combineAsVariants needs at least two COMPONENT nodes.');
    file = combined;
    if (parentId) {
      file = { ...file, document: moveNode(file.document, setId, parentId, Number.MAX_SAFE_INTEGER), lastModified: Date.now() };
    }
    return setId;
  };

  /**
   * Union / subtract / intersect / exclude, backed by the model's boolean
   * engine. Operands stay as children of the new BOOLEAN_OPERATION, as in Figma.
   */
  const booleanOperation = (nodeIds: string[], mode: BooleanMode, parentId?: string): string => {
    if (nodeIds.length < 2) throw new Error(`${mode.toLowerCase()} requires at least two nodes`);
    const result = booleanNodes(file, nodeIds, mode);
    if (!result.nodeId) throw new Error(`${mode.toLowerCase()} produced no result (unsupported operands)`);
    file = result.file;
    if (parentId) {
      file = { ...file, document: moveNode(file.document, result.nodeId, parentId, Number.MAX_SAFE_INTEGER), lastModified: Date.now() };
    }
    if (result.skipped.length > 0) warn(`${mode.toLowerCase()} skipped unsupported operands: ${result.skipped.join(', ')}`);
    if (result.empty) warn(`${mode.toLowerCase()} produced empty geometry (operands preserved)`);
    return result.nodeId;
  };

  /** Deep-clone a component subtree with fresh ids (instance materialization). */
  const cloneSubtree = (node: SceneNode): SceneNode => {
    const clone = { ...node, id: nextNodeId() } as SceneNode & { children?: SceneNode[] };
    if ('children' in node && Array.isArray(node.children)) {
      clone.children = node.children.map((child) => cloneSubtree(child));
    }
    return clone as SceneNode;
  };

  const createInstance = (componentId: string): string => {
    const component = requireNode(componentId);
    if (component.type !== 'COMPONENT' && component.type !== 'COMPONENT_SET') {
      throw new Error(`createInstance requires a COMPONENT (got ${component.type}). Create one with figma.createComponent().`);
    }
    const source =
      component.type === 'COMPONENT_SET' && 'children' in component && component.children[0]
        ? (component.children[0] as SceneNode)
        : (component as SceneNode);
    const children = 'children' in source && Array.isArray(source.children)
      ? source.children.map((child) => cloneSubtree(child))
      : [];
    const instance: InstanceNode = {
      id: nextNodeId(),
      name: component.name,
      type: 'INSTANCE',
      visible: true,
      locked: false,
      opacity: component.opacity,
      transform: { ...component.transform },
      width: component.width,
      height: component.height,
      fills: component.fills.map((paint) => ({ ...paint })),
      strokes: component.strokes.map((paint) => ({ ...paint })),
      strokeWeight: component.strokeWeight,
      strokeAlign: component.strokeAlign,
      effects: component.effects?.map((effect) => ({ ...effect })),
      cornerRadius: 'cornerRadius' in component ? component.cornerRadius : undefined,
      children,
      componentId: component.id,
      componentSnapshot: cloneSubtree(source),
    };
    const parentId = pageId();
    file = { ...file, document: insertChild(file.document, parentId, instance), lastModified: Date.now() };
    return instance.id;
  };

  const vectorNetworkToPath = (value: unknown): string => {
    if (typeof value !== 'object' || value === null) throw new Error('vectorNetwork must be an object');
    const network = value as {
      vertices?: Array<{ x?: number; y?: number }>;
      segments?: Array<{ start?: number; end?: number; tangentStart?: { x?: number; y?: number }; tangentEnd?: { x?: number; y?: number } }>;
      regions?: Array<{ loops?: number[][] }>;
    };
    const vertices = network.vertices ?? [];
    const segments = network.segments ?? [];
    if (vertices.length === 0 || segments.length === 0) throw new Error('vectorNetwork needs vertices and segments');
    const point = (index: number): { x: number; y: number } => {
      const vertex = vertices[index];
      if (!vertex) throw new Error(`vectorNetwork segment references vertex ${index} but only ${vertices.length} exist`);
      return { x: vertex.x ?? 0, y: vertex.y ?? 0 };
    };
    const parts: string[] = [];
    const loops = (network.regions ?? []).flatMap((region) => region.loops ?? []);
    const ordered = loops.length > 0 ? loops : [segments.map((_segment, index) => index)];
    for (const loop of ordered) {
      const first = segments[loop[0] ?? -1];
      if (!first) continue;
      let current = first.start ?? 0;
      const start = point(current);
      const commands: string[] = [];
      let last: { x: number; y: number } | null = null;
      for (const segmentIndex of loop) {
        const segment = segments[segmentIndex];
        if (!segment) continue;
        const forward = (segment.start ?? 0) === current;
        const from = point(forward ? (segment.start ?? 0) : (segment.end ?? 0));
        const to = point(forward ? (segment.end ?? 0) : (segment.start ?? 0));
        const tStart = forward ? segment.tangentStart : segment.tangentEnd;
        const tEnd = forward ? segment.tangentEnd : segment.tangentStart;
        const straight =
          (tStart?.x ?? 0) === 0 && (tStart?.y ?? 0) === 0 && (tEnd?.x ?? 0) === 0 && (tEnd?.y ?? 0) === 0;
        if (straight) commands.push(`L${to.x} ${to.y}`);
        else {
          commands.push(
            `C${from.x + (tStart?.x ?? 0)} ${from.y + (tStart?.y ?? 0)} ${to.x + (tEnd?.x ?? 0)} ${to.y + (tEnd?.y ?? 0)} ${to.x} ${to.y}`,
          );
        }
        last = to;
        current = forward ? (segment.end ?? 0) : (segment.start ?? 0);
      }
      // A closing segment back to the start is redundant before `Z`.
      if (last && last.x === start.x && last.y === start.y) commands.pop();
      parts.push(`M${start.x} ${start.y}`, ...commands, 'Z');
    }
    if (parts.length === 0) throw new Error('vectorNetwork produced no geometry');
    return parts.join(' ');
  };

  const get = (nodeId: string, prop: string): unknown => {
    const node = requireNode(nodeId);
    if ((AUTO_LAYOUT_PROPS as readonly string[]).includes(prop)) {
      const layout = 'autoLayout' in node ? (node.autoLayout as AutoLayout | undefined) : undefined;
      if (!layout) return prop === 'layoutMode' ? 'NONE' : undefined;
      return (layout as unknown as Record<string, unknown>)[prop];
    }
    switch (prop) {
      case 'id':
        return node.id;
      case 'type':
        return node.type;
      case 'name':
        return node.name;
      case 'visible':
        return node.visible;
      case 'opacity':
        return node.opacity;
      case 'width':
        return node.width;
      case 'height':
        return node.height;
      case 'x':
        return node.transform.tx;
      case 'y':
        return node.transform.ty;
      case 'rotation':
        return rotationOf(node.transform);
      case 'fills':
        return node.fills;
      case 'strokes':
        return node.strokes;
      case 'characters':
        return node.type === 'TEXT' ? node.characters : undefined;
      case 'fontSize':
        return requireText(node, prop).style.fontSize;
      case 'fontName':
        return { family: requireText(node, prop).style.fontFamily, style: requireText(node, prop).style.fontStyle ?? 'Regular' };
      case 'letterSpacing':
        return requireText(node, prop).style.letterSpacing;
      case 'lineHeight':
        return requireText(node, prop).style.lineHeight;
      case 'textAlignHorizontal':
        return requireText(node, prop).style.textAlignHorizontal ?? 'LEFT';
      case 'textAlignVertical':
        return requireText(node, prop).style.textAlignVertical ?? 'TOP';
      case 'textCase':
        return requireText(node, prop).style.textCase ?? 'ORIGINAL';
      case 'textDecoration':
        return requireText(node, prop).style.textDecoration ?? 'NONE';
      case 'cornerRadius':
        return 'cornerRadius' in node ? node.cornerRadius : undefined;
      case 'layoutAlign':
      case 'layoutGrow':
        return (node as unknown as Record<string, unknown>)[prop];
      case 'vectorPaths':
        return 'pathData' in node && node.pathData
          ? [{ windingRule: ('windingRule' in node ? node.windingRule : undefined) ?? 'NONZERO', data: node.pathData }]
          : [];
      case 'vectorNetwork':
      case 'vectorNetworkAsync':
        // Explicit unsupported error: Pigma has no vertex/segment store, so an
        // editable network cannot be read back. Returning null would make
        // scripts fail later and obscurely.
        throw new Error(
          `${prop} is not supported by Pigma: the model stores pathData, not an editable vertex/segment network. ` +
            'Read node.vectorPaths instead, or assign a network to convert its geometry to pathData.',
        );
      case 'componentPropertyDefinitions':
        return node.type === 'COMPONENT' || node.type === 'COMPONENT_SET' ? node.componentPropertyDefinitions ?? {} : undefined;
      case 'componentProperties':
        return node.type === 'INSTANCE' ? node.componentProperties ?? {} : undefined;
      case 'componentId':
        return node.type === 'INSTANCE' ? node.componentId : undefined;
      case 'componentPropertyReferences':
        return node.componentPropertyReferences ?? {};
      case 'styles':
        return node.styles ?? {};
      case 'boundVariables':
        return node.boundVariables ?? {};
      case 'windingRule':
        return 'windingRule' in node ? node.windingRule ?? 'NONZERO' : 'NONZERO';
      case 'rectangleCornerRadii':
        return 'rectangleCornerRadii' in node ? node.rectangleCornerRadii : undefined;
      case 'description':
        return 'description' in node ? (node as { description?: string }).description ?? '' : '';
      case 'effects':
        return node.effects ?? [];
      default:
        throw new Error(`Unsupported property "${prop}"`);
    }
  };

  const set = (nodeId: string, prop: string, value: unknown): void => {
    if (READ_ONLY.has(prop)) throw new Error(`Property "${prop}" is read-only`);
    if (prop === 'vectorNetwork' || prop === 'vectorNetworkAsync') {
      // Convert to a path and keep the geometry; the network itself is not
      // retained (Pigma's model has no vertex/segment store).
      const data = vectorNetworkToPath(value);
      warn(`${prop} converted to pathData; vertex/segment editing is not supported (use vectorPaths)`);
      file = {
        ...file,
        document: updateNode(file.document, nodeId, (node: AnyNode) => {
          const next = { ...node } as AnyNode & Record<string, unknown>;
          next.pathData = data;
          next.windingRule = 'NONZERO';
          return next as AnyNode;
        }),
        lastModified: Date.now(),
      };
      return;
    }
    const apply = (node: AnyNode): AnyNode => {
      const next = { ...node } as AnyNode & Record<string, unknown>;
      if ((AUTO_LAYOUT_PROPS as readonly string[]).includes(prop)) {
        const layout: AutoLayout = { ...((next.autoLayout as AutoLayout | undefined) ?? { layoutMode: 'NONE' }) };
        (layout as unknown as Record<string, unknown>)[prop] = value;
        if (prop === 'layoutMode' && value === 'NONE') delete (layout as unknown as Record<string, unknown>).itemSpacing;
        next.autoLayout = layout;
        return next as AnyNode;
      }
      switch (prop) {
        case 'name':
          if (typeof value !== 'string') throw new Error('name must be a string');
          next.name = value;
          break;
        case 'visible':
          next.visible = Boolean(value);
          break;
        case 'opacity':
          if (typeof value !== 'number') throw new Error('opacity must be a number');
          next.opacity = value;
          break;
        case 'width':
        case 'height':
          if (typeof value !== 'number') throw new Error(`${prop} must be a number`);
          next[prop] = value;
          break;
        case 'x':
        case 'y':
          if (typeof value !== 'number') throw new Error(`${prop} must be a number`);
          next.transform = { ...next.transform, [prop === 'x' ? 'tx' : 'ty']: value };
          break;
        case 'rotation': {
          if (typeof value !== 'number') throw new Error('rotation must be a number');
          const base = { ...next.transform };
          const scaleX = base.a === 0 && base.b === 0 ? 1 : Math.hypot(base.a, base.b);
          const scaleY = base.d === 0 && base.c === 0 ? 1 : Math.hypot(base.d, base.c);
          next.transform = fromTRS(base.tx, base.ty, value, scaleX, scaleY);
          break;
        }
        case 'fills':
          next.fills = toPaintList(value);
          break;
        case 'strokes':
          next.strokes = toPaintList(value);
          break;
        case 'characters':
          if (next.type !== 'TEXT') throw new Error('characters is only valid on TEXT nodes');
          if (typeof value !== 'string') throw new Error('characters must be a string');
          next.characters = value;
          break;
        case 'fontSize':
          next.style = { ...requireText(next, prop).style, fontSize: requirePositiveNumber(value, prop) };
          break;
        case 'fontName': {
          const style = requireText(next, prop).style;
          if (!isRecord(value)) throw new Error('fontName must be an object with family and style');
          const family = value.family;
          const fontStyle = value.style;
          if (typeof family !== 'string' || family.trim() === '') throw new Error('fontName.family must be a non-empty string');
          if (typeof fontStyle !== 'string' || fontStyle.trim() === '') throw new Error('fontName.style must be a non-empty string');
          // Matches figma.loadFontAsync: the host accepts any family/style pair,
          // so a script may set fontName after awaiting it.
          next.style = { ...style, fontFamily: family, fontStyle };
          break;
        }
        case 'letterSpacing': {
          const style = requireText(next, prop).style;
          if (!isRecord(value)) throw new Error('letterSpacing must be an object with unit and value');
          const unit = requireOneOf(value.unit, ['PIXELS', 'PERCENT'] as const, 'letterSpacing.unit');
          next.style = { ...style, letterSpacing: { unit, value: requireFiniteNumber(value.value, 'letterSpacing.value') } };
          break;
        }
        case 'lineHeight': {
          const style = requireText(next, prop).style;
          if (!isRecord(value)) throw new Error('lineHeight must be an object with unit and value');
          const unit = requireOneOf(value.unit, ['PIXELS', 'PERCENT', 'AUTO'] as const, 'lineHeight.unit');
          // Figma's AUTO line height carries no value; the others require one.
          next.style =
            unit === 'AUTO'
              ? { ...style, lineHeight: { unit } }
              : { ...style, lineHeight: { unit, value: requireFiniteNumber(value.value, 'lineHeight.value') } };
          break;
        }
        case 'textAlignHorizontal':
          next.style = { ...requireText(next, prop).style, textAlignHorizontal: requireOneOf(value, TEXT_ALIGN_HORIZONTAL, prop) };
          break;
        case 'textAlignVertical':
          next.style = { ...requireText(next, prop).style, textAlignVertical: requireOneOf(value, TEXT_ALIGN_VERTICAL, prop) };
          break;
        case 'textCase':
          next.style = { ...requireText(next, prop).style, textCase: requireOneOf(value, TEXT_CASES, prop) };
          break;
        case 'textDecoration':
          next.style = { ...requireText(next, prop).style, textDecoration: requireOneOf(value, TEXT_DECORATIONS, prop) };
          break;
        case 'cornerRadius':
          if (typeof value !== 'number') throw new Error('cornerRadius must be a number');
          next.cornerRadius = value;
          break;
        case 'layoutAlign':
        case 'layoutGrow':
          (next as Record<string, unknown>)[prop] = value;
          break;
        case 'effects':
          if (!Array.isArray(value)) throw new Error('effects must be an array');
          next.effects = value as never;
          break;
        case 'description':
          if (typeof value !== 'string') throw new Error('description must be a string');
          next.description = value;
          break;
        case 'windingRule':
          if (value !== 'NONZERO' && value !== 'EVENODD') throw new Error('windingRule must be "NONZERO" or "EVENODD"');
          next.windingRule = value;
          break;
        case 'rectangleCornerRadii': {
          if (!Array.isArray(value) || value.length !== 4 || value.some((entry) => typeof entry !== 'number')) {
            throw new Error('rectangleCornerRadii must be an array of four numbers');
          }
          next.rectangleCornerRadii = value as [number, number, number, number];
          break;
        }
        case 'styles': {
          if (!isRecord(value)) throw new Error('styles must be an object of style ids by property');
          const styles: Record<string, string> = {};
          for (const [key, styleId] of Object.entries(value)) {
            if (typeof styleId === 'string') styles[key] = styleId;
          }
          next.styles = styles;
          break;
        }
        case 'boundVariables': {
          if (!isRecord(value)) throw new Error('boundVariables must be an object of variable ids by property');
          const bound: Record<string, string> = {};
          for (const [key, variableId] of Object.entries(value)) {
            if (typeof variableId === 'string') bound[key] = variableId;
          }
          next.boundVariables = bound;
          break;
        }
        case 'componentPropertyReferences': {
          if (!isRecord(value)) throw new Error('componentPropertyReferences must be an object of property names by field');
          const references: Record<string, string> = {};
          for (const [key, propertyName] of Object.entries(value)) {
            if (typeof propertyName === 'string') references[key] = propertyName;
          }
          next.componentPropertyReferences = references;
          break;
        }
        case 'componentProperties': {
          if (next.type !== 'INSTANCE') throw new Error('componentProperties is only valid on INSTANCE nodes');
          if (!isRecord(value)) throw new Error('componentProperties must be an object of values by property');
          const properties: Record<string, string | boolean> = {};
          for (const [key, entry] of Object.entries(value)) {
            if (typeof entry === 'string' || typeof entry === 'boolean') properties[key] = entry;
          }
          next.componentProperties = properties;
          break;
        }
        case 'vectorPaths': {
          if (!Array.isArray(value)) throw new Error('vectorPaths must be an array of { windingRule, data }');
          const paths = value as Array<{ windingRule?: string; data?: string }>;
          const data = paths.map((path) => path.data ?? '').filter((entry) => entry.length > 0);
          if (data.length === 0) throw new Error('vectorPaths entries need a `data` SVG path string');
          next.pathData = data.join(' ');
          next.windingRule = paths[0]?.windingRule === 'EVENODD' ? 'EVENODD' : 'NONZERO';
          break;
        }
        default:
          throw new Error(`Unsupported property "${prop}"`);
      }
      return next as AnyNode;
    };
    file = { ...file, document: updateNode(file.document, nodeId, apply), lastModified: Date.now() };
  };

  const call = (nodeId: string, method: string, args: unknown[]): unknown => {
    switch (method) {
      case 'resize': {
        const [width, height] = args;
        if (typeof width !== 'number' || typeof height !== 'number') throw new Error('resize(width, height) requires two numbers');
        file = {
          ...file,
          document: updateNode(file.document, nodeId, (node: AnyNode) => ({ ...node, width, height }) as AnyNode),
          lastModified: Date.now(),
        };
        return undefined;
      }
      case 'appendChild': {
        const childId = args[0];
        if (typeof childId !== 'string') throw new Error('appendChild(node) requires a node');
        file = { ...file, document: moveNode(file.document, childId, nodeId, Number.MAX_SAFE_INTEGER), lastModified: Date.now() };
        return undefined;
      }
      case 'createInstance': {
        return createInstance(nodeId);
      }
      case 'setProperties': {
        // Figma's InstanceNode.setProperties: VARIANT names switch the variant
        // (re-pointing componentId and carrying the variant's box), the rest
        // update the property map.
        const values = args[0];
        if (!isRecord(values)) throw new Error('setProperties(properties) requires an object');
        const node = requireNode(nodeId);
        if (node.type !== 'INSTANCE') throw new Error('setProperties is only valid on INSTANCE nodes');
        const set = componentSetOf(file, node.componentId);
        const definitions = set ? componentPropertiesOf(set) : {};
        for (const [name, value] of Object.entries(values)) {
          if (typeof value !== 'string' && typeof value !== 'boolean') {
            throw new Error(`setProperties: "${name}" must be a string or boolean`);
          }
          const definition = definitions[name];
          if (definition?.type === 'VARIANT' && typeof value === 'string') {
            file = setInstanceVariant(file, nodeId, name, value);
          } else {
            file = setInstanceProperty(file, nodeId, name, value);
          }
        }
        return undefined;
      }
      case 'remove': {
        const removed = removeNode(file.document, nodeId);
        file = { ...file, document: removed.root, lastModified: Date.now() };
        return undefined;
      }
      default:
        throw new Error(
          `Unsupported node method "${method}". Supported: resize, appendChild, remove, createInstance, setProperties. (Plugin parameters and figma.ui are not available.)`,
        );
    }
  };

  return {
    get file() {
      return file;
    },
    logs,
    warnings,
    get closed() {
      return closed;
    },
    documentId: () => file.document.id,
    pageId,
    hasNode: (nodeId) => findNode(file.document, nodeId) !== null,
    children: (nodeId) => {
      const node = requireNode(nodeId);
      return 'children' in node && Array.isArray(node.children) ? node.children.map((child) => child.id) : [];
    },
    create,
    createInstance,
    combineAsVariants,
    booleanOperation,
    get,
    set,
    call,
    getSelection: () => [...selection],
    setSelection: (ids) => {
      for (const id of ids) requireNode(id);
      selection = [...ids];
    },
    log: (text) => {
      logs.push(text);
    },
    warn,
    close: () => {
      closed = true;
    },
  };
}
