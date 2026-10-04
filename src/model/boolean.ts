import * as polygonClippingNamespace from 'polygon-clipping';
import type { AnyNode, ContainerNode, PigmaFile, Rect, SceneNode } from './types';
import { createShapeNode } from './factory';
import { findNode, insertChild, parentAndIndex, removeNode, updateNode, worldTransform } from './tree';
import { hasChildren } from './types';
import { anchorsFromPathData, type VectorAnchor } from './vector';

/**
 * Boolean operations (union / subtract / intersect / exclude).
 *
 * Figma keeps curves through a boolean; Pigma flattens every operand to polygons
 * first (16 samples per cubic segment, 64 around an ellipse) and runs an exact
 * polygon boolean, so the result is a polygon approximation of the same shape.
 * That approximation is deliberate and documented rather than hidden: geometry
 * is never silently wrong, it is polygonal.
 *
 * The operands are kept as children of the resulting BOOLEAN_OPERATION node, the
 * way Figma stores them, so the operation stays inspectable and undoable.
 */

export type BooleanMode = 'UNION' | 'SUBTRACT' | 'INTERSECT' | 'EXCLUDE';

export const BOOLEAN_MODES: BooleanMode[] = ['UNION', 'SUBTRACT', 'INTERSECT', 'EXCLUDE'];

export function booleanLabel(mode: BooleanMode): string {
  switch (mode) {
    case 'UNION':
      return 'Union';
    case 'SUBTRACT':
      return 'Subtract';
    case 'INTERSECT':
      return 'Intersect';
    case 'EXCLUDE':
      return 'Exclude';
    default:
      return mode;
  }
}

const CURVE_SAMPLES = 16;
const ELLIPSE_SAMPLES = 64;

type Ring = Array<[number, number]>;

/**
 * `polygon-clipping` ships CommonJS, so a bundler may expose it either as the
 * namespace or behind `default`; pick whichever actually carries the functions.
 */
type Clipping = typeof polygonClippingNamespace;
type MultiPolygon = Clipping['union'] extends (...args: never[]) => infer R ? R : never;

const polygonClipping: Clipping = (polygonClippingNamespace as { default?: Clipping }).default ?? polygonClippingNamespace;

/** Sample a cubic Bezier between two anchors. */
function sampleCubic(from: VectorAnchor, to: VectorAnchor): Ring {
  const c1 = { x: from.x + (from.out?.x ?? 0), y: from.y + (from.out?.y ?? 0) };
  const c2 = { x: to.x + (to.in?.x ?? 0), y: to.y + (to.in?.y ?? 0) };
  const points: Ring = [];
  for (let step = 1; step <= CURVE_SAMPLES; step += 1) {
    const t = step / CURVE_SAMPLES;
    const u = 1 - t;
    points.push([
      u * u * u * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * to.x,
      u * u * u * from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * to.y,
    ]);
  }
  return points;
}

/** Local-space outline of a node, before its transform. */
function localOutline(node: SceneNode): Ring[] | null {
  switch (node.type) {
    case 'ELLIPSE': {
      const ring: Ring = [];
      for (let step = 0; step < ELLIPSE_SAMPLES; step += 1) {
        const angle = (step / ELLIPSE_SAMPLES) * Math.PI * 2;
        ring.push([node.width / 2 + (Math.cos(angle) * node.width) / 2, node.height / 2 + (Math.sin(angle) * node.height) / 2]);
      }
      return [ring];
    }
    case 'RECTANGLE':
    case 'FRAME':
    case 'COMPONENT':
    case 'COMPONENT_SET':
    case 'INSTANCE':
    case 'SECTION':
    case 'GROUP':
      return [
        [
          [0, 0],
          [node.width, 0],
          [node.width, node.height],
          [0, node.height],
        ],
      ];
    case 'LINE':
      return null;
    case 'VECTOR':
    case 'BOOLEAN_OPERATION': {
      const path = node.pathData ? anchorsFromPathData(node.pathData) : null;
      if (!path) return null;
      const ring: Ring = [];
      const anchors = path.anchors;
      const segments = path.closed ? anchors.length : anchors.length - 1;
      const first = anchors[0];
      if (!first) return null;
      ring.push([first.x, first.y]);
      for (let index = 0; index < segments; index += 1) {
        const from = anchors[index];
        const to = anchors[(index + 1) % anchors.length];
        if (!from || !to) continue;
        if (from.out || to.in) ring.push(...sampleCubic(from, to));
        else ring.push([to.x, to.y]);
      }
      return [ring];
    }
    default:
      // Text and anything without an outline cannot be boolean-ed.
      return null;
  }
}

/** World-space polygons for a node (flattened). */
export function nodePolygons(root: AnyNode, id: string): Ring[] | null {
  const node = findNode(root, id);
  if (!node || node.type === 'DOCUMENT' || node.type === 'CANVAS') return null;
  const outline = localOutline(node as SceneNode);
  if (!outline) return null;
  const m = worldTransform(root, id);
  return outline.map((ring) =>
    ring.map(([x, y]) => [m.a * x + m.c * y + m.tx, m.b * x + m.d * y + m.ty] as [number, number]),
  );
}

function polygonsToPathData(polygons: Ring[][]): string {
  const parts: string[] = [];
  for (const polygon of polygons) {
    for (const ring of polygon) {
      if (ring.length < 3) continue;
      const points = ring.map(([x, y]) => `${Math.round(x * 100) / 100} ${Math.round(y * 100) / 100}`);
      parts.push(`M ${points[0]} L ${points.slice(1).join(' L ')} Z`);
    }
  }
  return parts.join(' ');
}

function boundsOfPolygons(polygons: Ring[][]): Rect | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (const [x, y] of ring) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export interface BooleanResult {
  file: PigmaFile;
  nodeId: string | null;
  /** Operands that could not be flattened (text, lines, unsupported paths). */
  skipped: string[];
  /** True when the operation produced no area (e.g. intersecting disjoint shapes). */
  empty: boolean;
}

export interface BooleanGeometry {
  pathData: string;
  bounds: { x: number; y: number; width: number; height: number } | null;
  empty: boolean;
  skipped: string[];
}

/** Compute the combined geometry of `ids` under `mode`, without touching the tree. */
export function booleanGeometry(file: PigmaFile, ids: string[], mode: BooleanMode): BooleanGeometry {
  const operands: Array<{ id: string; polygons: Ring[] }> = [];
  const skipped: string[] = [];
  for (const id of ids) {
    const polygons = nodePolygons(file.document, id);
    if (!polygons || polygons.length === 0) {
      skipped.push(id);
      continue;
    }
    operands.push({ id, polygons });
  }
  if (operands.length < 2) return { pathData: '', bounds: null, empty: false, skipped };

  const inputs = operands.map((operand) => [operand.polygons] as MultiPolygon);
  let result: MultiPolygon;
  try {
    const [first, ...rest] = inputs as [MultiPolygon, ...MultiPolygon[]];
    switch (mode) {
      case 'UNION':
        result = polygonClipping.union(first, ...rest);
        break;
      case 'SUBTRACT':
        result = polygonClipping.difference(first, ...rest);
        break;
      case 'INTERSECT':
        result = polygonClipping.intersection(first, ...rest);
        break;
      case 'EXCLUDE':
        result = polygonClipping.xor(first, ...rest);
        break;
      default:
        return { pathData: '', bounds: null, empty: false, skipped };
    }
  } catch {
    return { pathData: '', bounds: null, empty: false, skipped };
  }

  const polygons = result as unknown as Ring[][];
  const empty = polygons.length === 0;
  const bounds = boundsOfPolygons(polygons) ?? boundsOfPolygons(operands.map((operand) => operand.polygons));
  if (!bounds) return { pathData: '', bounds: null, empty: false, skipped };
  const localised = polygons.map((polygon) => polygon.map((ring) => ring.map(([x, y]) => [x - bounds.x, y - bounds.y] as [number, number])));
  return { pathData: empty ? '' : polygonsToPathData(localised), bounds, empty, skipped };
}

/**
 * Re-run an existing boolean node with another mode, keeping its id, children and
 * position (Figma's boolean group switch).
 */
export function setBooleanMode(file: PigmaFile, nodeId: string, mode: BooleanMode): PigmaFile {
  const node = findNode(file.document, nodeId);
  if (!node || node.type !== 'BOOLEAN_OPERATION') return file;
  const operandIds = (Array.isArray((node as ContainerNode).children) ? (node as ContainerNode).children : []).map(
    (child) => child.id,
  );
  if (operandIds.length < 2) return file;
  const geometry = booleanGeometry(file, operandIds, mode);
  if (!geometry.bounds) return file;
  const document = updateNode(file.document, nodeId, (target) => ({
    ...target,
    name: booleanLabel(mode),
    booleanOperation: mode,
    pathData: geometry.pathData,
    width: Math.max(1, geometry.bounds!.width),
    height: Math.max(1, geometry.bounds!.height),
  } as typeof target));
  return { ...file, document };
}

/** Combine the given nodes with a boolean operation. */
export function booleanNodes(file: PigmaFile, ids: string[], mode: BooleanMode): BooleanResult {
  const geometry = booleanGeometry(file, ids, mode);
  const { skipped, empty, bounds } = geometry;
  if (!bounds) return { file, nodeId: null, skipped, empty: false };
  const pathData = geometry.pathData;
  const operands = ids.map((id) => ({ id }));

  const parentInfo = parentAndIndex(file.document, operands[0]!.id);
  if (!parentInfo) return { file, nodeId: null, skipped, empty: false };

  // BOOLEAN_OPERATION is a container that also carries its own pathData.
  const node: ContainerNode = {
    ...createShapeNode(file.document, 'RECTANGLE', bounds.x, bounds.y, Math.max(1, bounds.width), Math.max(1, bounds.height)),
    type: 'BOOLEAN_OPERATION',
    name: booleanLabel(mode),
    booleanOperation: mode,
    pathData,
    windingRule: 'EVENODD',
    children: [],
    clipsContent: false,
    strokes: [],
    strokeWeight: 1,
    strokeAlign: 'CENTER',
  };

  // Carry the first operand's appearance so the result looks like what was there.
  const first = findNode(file.document, operands[0]!.id);
  if (first && first.type !== 'DOCUMENT' && first.type !== 'CANVAS') {
    node.fills = first.fills.map((paint) => ({ ...paint }));
    node.effects = (first.effects ?? []).map((effect) => ({ ...effect }));
    node.opacity = first.opacity;
  }

  // Move the operands inside the boolean node (Figma keeps them as children).
  let document = file.document;
  const children: SceneNode[] = [];
  const removed = operands.map((operand) => operand.id);
  for (const id of removed) {
    const stripped = removeNode(document, id);
    document = stripped.root;
    if (stripped.removed) children.push(stripped.removed);
  }
  // Children live in the boolean node's local space.
  const placed = children.map((child) => ({
    ...child,
    transform: { ...child.transform, tx: child.transform.tx - bounds.x, ty: child.transform.ty - bounds.y },
  }));
  const withChildren = { ...node, children: placed } as SceneNode;

  const index = parentInfo.index;
  const inserted = insertChild(document, parentInfo.parent.id, withChildren, index);
  return { file: { ...file, document: inserted }, nodeId: node.id, skipped, empty };
}

/**
 * Evaluate a boolean node **in its own local space**, from its children.
 *
 * The operands are the node's children (Figma's model), so moving or resizing one
 * changes the result; this is what makes the operation live rather than baked.
 * The result is localised to the content's bounds, and the caller re-anchors the
 * node on them exactly as `booleanNodes` does at creation, so the operands keep
 * their world positions and an unchanged boolean evaluates to itself.
 */
export function evaluateBooleanNode(node: ContainerNode): ContainerNode | null {
  const children = (node.children ?? []) as SceneNode[];
  if (children.length < 2 || !node.booleanOperation) return null;

  // World transforms *within this node* are the children's local transforms, so
  // the geometry comes back in the node's own coordinate space.
  const polygons: Array<{ id: string; rings: Ring[] }> = [];
  for (const child of children) {
    const rings = nodePolygons(node, child.id);
    if (!rings || rings.length === 0) continue;
    polygons.push({ id: child.id, rings });
  }
  if (polygons.length < 2) return null;

  const mode = node.booleanOperation;
  const inputs = polygons.map((operand) => [operand.rings] as MultiPolygon);
  let result: MultiPolygon;
  try {
    const [first, ...rest] = inputs as [MultiPolygon, ...MultiPolygon[]];
    switch (mode) {
      case 'UNION':
        result = polygonClipping.union(first, ...rest);
        break;
      case 'SUBTRACT':
        result = polygonClipping.difference(first, ...rest);
        break;
      case 'INTERSECT':
        result = polygonClipping.intersection(first, ...rest);
        break;
      case 'EXCLUDE':
        result = polygonClipping.xor(first, ...rest);
        break;
      default:
        return null;
    }
  } catch {
    // A self-intersecting operand set: keep what the node already has rather than
    // replacing it with an empty shape.
    return null;
  }

  const shapes = result as unknown as Ring[][];
  const bounds = boundsOfPolygons(shapes) ?? boundsOfPolygons(polygons.map((operand) => operand.rings));
  if (!bounds) return null;
  const localised = shapes.map((polygon) =>
    polygon.map((ring) => ring.map(([x, y]) => [x - bounds.x, y - bounds.y] as [number, number])),
  );
  const pathData = shapes.length === 0 ? '' : polygonsToPathData(localised);
  const width = Math.max(1, bounds.width);
  const height = Math.max(1, bounds.height);

  if (node.pathData === pathData && node.width === width && node.height === height) return node;

  // Re-anchor on the content, exactly like creation: the node moves to its
  // content's top-left and the children shift back by the same amount, so their
  // world positions are unchanged by a re-evaluation.
  const placed = children.map((child) => ({
    ...child,
    transform: { ...child.transform, tx: child.transform.tx - bounds.x, ty: child.transform.ty - bounds.y },
  }));
  return {
    ...node,
    pathData,
    width,
    height,
    transform: { ...node.transform, tx: node.transform.tx + bounds.x, ty: node.transform.ty + bounds.y },
    children: placed,
  };
}

/**
 * Re-evaluate every boolean operation in a document, bottom-up so a boolean
 * inside a boolean sees settled operands. Returns the same tree when nothing
 * changed, so it can run after every edit without creating undo entries.
 */
export function refreshBooleans<T extends AnyNode>(root: T): T {
  if (!hasChildren(root)) return root;
  const container = root as unknown as ContainerNode;
  let changed = false;
  const children = container.children.map((child) => {
    const refreshed = refreshBooleans(child);
    if (refreshed !== child) changed = true;
    return refreshed;
  });
  const withChildren = (changed ? { ...container, children } : root) as T;
  if (withChildren.type !== 'BOOLEAN_OPERATION') return withChildren;
  const evaluated = evaluateBooleanNode(withChildren as unknown as ContainerNode);
  return (evaluated ?? withChildren) as T;
}

/** True when a node can take part in a boolean operation. */
export function canBoolean(node: SceneNode): boolean {
  return localOutline(node) !== null;
}

export function booleanOperandsOf(file: PigmaFile, ids: string[]): { usable: string[]; skipped: string[] } {
  const usable: string[] = [];
  const skipped: string[] = [];
  for (const id of ids) {
    const node = findNode(file.document, id);
    if (!node || node.type === 'DOCUMENT' || node.type === 'CANVAS' || !canBoolean(node as SceneNode)) {
      skipped.push(id);
      continue;
    }
    usable.push(id);
  }
  return { usable, skipped };
}
