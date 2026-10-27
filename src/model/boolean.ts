import * as polygonClippingNamespace from 'polygon-clipping';
import type { AnyNode, ContainerNode, PigmaFile, Rect, SceneNode } from './types';
import { createShapeNode } from './factory';
import { findNode, insertChild, parentAndIndex, removeNode, updateNode, worldTransform } from './tree';
import { applyToPoint, invert } from './matrix';
import { hasChildren } from './types';
import { subpathsFromPathData, type VectorAnchor, type VectorPath } from './vector';

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

/**
 * Sampling counts for the flattening pass.
 *
 * A cubic's polyline error falls as 1/n^2, measured over handle lengths 0.25..5
 * on a 100 px chord: 16 -> 1.250 px, 32 -> 0.350, 48 -> 0.159, 64 -> 0.090. 64 is
 * the count that lands the cubic at or below an ellipse's own error (64 samples:
 * sagitta 0.120 px at r=100), so the two operand kinds are equally accurate.
 *
 * A flat count, not an adaptive one: the adaptive formula needs a per-segment
 * second-derivative bound for a variable vertex count, and the measured flat cost
 * is already bounded and predictable (a curved operand goes 18 -> 66 points, 4x,
 * while ellipses and rectangles are unchanged).
 */
const CURVE_SAMPLES = 64;
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
      // One ring per subpath: a contour is a region of its own, and they combine even-odd.
      const paths = node.pathData ? subpathsFromPathData(node.pathData) : null;
      if (!paths) return null;
      const rings = paths.map(ringOfPath);
      return rings.every((ring): ring is Ring => ring !== null) ? rings : null;
    }
    default:
      // Text and anything without an outline cannot be boolean-ed.
      return null;
  }
}

/** A subpath as a polygon ring, its curves sampled. `null` for an empty subpath. */
function ringOfPath(path: VectorPath): Ring | null {
  const anchors = path.anchors;
  const segments = path.closed ? anchors.length : anchors.length - 1;
  const first = anchors[0];
  if (!first) return null;
  const ring: Ring = [[first.x, first.y]];
  for (let index = 0; index < segments; index += 1) {
    const from = anchors[index];
    const to = anchors[(index + 1) % anchors.length];
    if (!from || !to) continue;
    if (from.out || to.in) ring.push(...sampleCubic(from, to));
    else ring.push([to.x, to.y]);
  }
  return ring;
}

/** World-space polygons for a node (flattened). */
export function nodePolygons(root: AnyNode, id: string): Ring[][] | null {
  const node = findNode(root, id);
  if (!node || node.type === 'DOCUMENT' || node.type === 'CANVAS') return null;
  const outline = localOutline(node as SceneNode);
  if (!outline) return null;
  const m = worldTransform(root, id);
  return evenOddPolygons(
    outline.map((ring) => ring.map(([x, y]) => [m.a * x + m.c * y + m.tx, m.b * x + m.d * y + m.ty] as [number, number])),
  );
}

/**
 * Combine contours even-odd: each is XOR-ed in turn, so a contour inside another is a
 * hole and separate contours are separate regions. A glyph's counters come out right.
 */
function evenOddPolygons(rings: Ring[]): Ring[][] {
  let result = [] as unknown as MultiPolygon;
  for (const ring of rings) {
    if (ring.length < 3) continue;
    result = polygonClipping.xor(result, [[ring]]);
  }
  return result as unknown as Ring[][];
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
  const operands: Array<{ id: string; polygons: Ring[][] }> = [];
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

  const inputs = operands.map((operand) => operand.polygons as unknown as MultiPolygon);
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
  const bounds = boundsOfPolygons(polygons) ?? boundsOfPolygons(operands.flatMap((operand) => operand.polygons));
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

  // The result sits inside its parent, so its position is in the parent's space. The bounds
  // are world-space: localise them, or a result inside an offset frame lands twice as far out.
  const origin = applyToPoint(invert(worldTransform(file.document, parentInfo.parent.id)), bounds.x, bounds.y);

  // BOOLEAN_OPERATION is a container that also carries its own pathData.
  const node: ContainerNode = {
    ...createShapeNode(file.document, 'RECTANGLE', origin.x, origin.y, Math.max(1, bounds.width), Math.max(1, bounds.height)),
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
  const polygons: Array<{ id: string; rings: Ring[][] }> = [];
  for (const child of children) {
    const rings = nodePolygons(node, child.id);
    if (!rings || rings.length === 0) continue;
    polygons.push({ id: child.id, rings });
  }
  if (polygons.length < 2) return null;

  const mode = node.booleanOperation;
  const inputs = polygons.map((operand) => operand.rings as unknown as MultiPolygon);
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
  const bounds = boundsOfPolygons(shapes) ?? boundsOfPolygons(polygons.flatMap((operand) => operand.rings));
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

/** The result of a divide: the layers it made, and the reason when it made none. */
export interface DivideResult {
  file: PigmaFile;
  nodeIds: string[];
  reason?: string;
}

/** The most shapes a divide takes: 15 regions at most, one per non-empty subset of them. */
export const DIVIDE_MAX_SHAPES = 4;

/**
 * Divide overlapping shapes into their regions. A region is the part covered by one set of shapes and by no others, so for
 * two shapes there are three: the lower shape alone, the overlap, and the upper shape alone. Each non-empty region becomes a
 * flat vector layer, placed where the lowest of the shapes was, ordered by its lowest shape and then by how many shapes it
 * covers. A region takes the paint of the top-most shape that covers it. The layers are static: unlike a boolean, they keep
 * no operands. The shapes must be two to four layers in the same parent that overlap; anything else is refused and the file
 * is unchanged.
 */
export function divideNodes(file: PigmaFile, ids: string[]): DivideResult {
  const refuse = (reason: string): DivideResult => ({ file, nodeIds: [], reason });
  if (ids.length < 2 || ids.length > DIVIDE_MAX_SHAPES) return refuse(`Divide takes two to ${DIVIDE_MAX_SHAPES} shapes`);
  const { usable } = booleanOperandsOf(file, ids);
  if (usable.length !== ids.length) return refuse('Divide needs shapes with an outline');
  const infos = usable.map((id) => ({ id, info: parentAndIndex(file.document, id) }));
  const parentId = infos[0]!.info?.parent.id;
  if (infos.some((entry) => !entry.info || entry.info.parent.id !== parentId)) {
    return refuse('Divide needs shapes in the same frame or group');
  }
  // Z order: a higher index is further up, so the top-most shape is the last one in the sorted list.
  const ordered = infos
    .map((entry) => ({ id: entry.id, index: entry.info!.index }))
    .sort((a, b) => a.index - b.index);
  const polygons: Ring[][][] = [];
  for (const shape of ordered) {
    const shapePolygons = nodePolygons(file.document, shape.id);
    if (!shapePolygons) return refuse('Divide needs shapes with an outline');
    polygons.push(shapePolygons);
  }

  // Each non-empty subset of the shapes is a candidate region: the subset's overlap, minus every shape outside it.
  const count = ordered.length;
  const regions: Array<{ polygons: Ring[][]; source: SceneNode; lowest: number; covers: number }> = [];
  try {
    for (let mask = 1; mask < 1 << count; mask += 1) {
      const members = ordered.map((_, index) => index).filter((index) => mask & (1 << index));
      const others = ordered.map((_, index) => index).filter((index) => !(mask & (1 << index)));
      const [firstMember, ...restMembers] = members.map((index) => polygons[index] as unknown as MultiPolygon);
      let region: MultiPolygon = restMembers.length > 0 ? polygonClipping.intersection(firstMember!, ...restMembers) : firstMember!;
      if (others.length > 0) {
        region = polygonClipping.difference(region, ...others.map((index) => polygons[index] as unknown as MultiPolygon));
      }
      const pieces = region as unknown as Ring[][];
      if (pieces.length === 0) continue;
      const top = ordered[members[members.length - 1]!]!;
      const source = findNode(file.document, top.id) as SceneNode;
      regions.push({ polygons: pieces, source, lowest: members[0]!, covers: members.length });
    }
  } catch {
    return refuse('Divide could not be applied');
  }
  // The shapes overlap only if some region is covered by more than one of them.
  if (!regions.some((region) => region.covers > 1)) return refuse('The shapes do not overlap, so there is nothing to divide');
  regions.sort((a, b) => a.lowest - b.lowest || a.covers - b.covers);

  const parentSpace = invert(worldTransform(file.document, parentId!));
  let document = file.document;
  for (const shape of ordered) document = removeNode(document, shape.id).root;
  const nodeIds: string[] = [];
  let index = ordered[0]!.index;
  for (const region of regions) {
    const bounds = boundsOfPolygons(region.polygons);
    if (!bounds) continue;
    const localised = region.polygons.map((polygon) =>
      polygon.map((ring) => ring.map(([x, y]) => [x - bounds.x, y - bounds.y] as [number, number])),
    );
    const origin = applyToPoint(parentSpace, bounds.x, bounds.y);
    const source = region.source as SceneNode & { fills?: unknown[]; strokes?: unknown[]; effects?: unknown[] };
    const piece = {
      ...createShapeNode(document, 'RECTANGLE', origin.x, origin.y, Math.max(1, bounds.width), Math.max(1, bounds.height)),
      type: 'VECTOR',
      name: source.name,
      pathData: polygonsToPathData(localised),
      windingRule: 'EVENODD',
      fills: (source.fills ?? []).map((paint) => ({ ...(paint as object) })),
      strokes: (source.strokes ?? []).map((paint) => ({ ...(paint as object) })),
      strokeWeight: source.strokeWeight,
      strokeAlign: source.strokeAlign,
      effects: (source.effects ?? []).map((effect) => ({ ...(effect as object) })),
      opacity: source.opacity,
    } as unknown as SceneNode;
    document = insertChild(document, parentId!, piece, index);
    nodeIds.push(piece.id);
    index += 1;
  }
  return { file: { ...file, document, lastModified: Date.now() }, nodeIds };
}
