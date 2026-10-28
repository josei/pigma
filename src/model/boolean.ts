import * as polygonClippingNamespace from 'polygon-clipping';
import type { AnyNode, ContainerNode, PigmaFile, Rect, SceneNode, StrokeCap, StrokeJoin } from './types';
import { createShapeNode } from './factory';
import { findNode, insertChild, parentAndIndex, removeNode, updateNode, worldTransform } from './tree';
import { applyToPoint, invert, multiply, translate } from './matrix';
import { firstVisibleFill } from './paint';
import { DEFAULT_MITER_LIMIT, hasChildren } from './types';
import { arrowheadsOf, isArrowCap } from './arrowheads';
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

/**
 * The open polylines of a line or a vector layer, in the layer's own coordinates: a line's one segment, and a vector's open
 * subpaths. Closed subpaths are left out; they have no ends for an arrowhead.
 */
export function openPolylinesOf(node: SceneNode): Ring[] {
  if (node.type === 'LINE') return [[[0, 0], [node.width, 0]]];
  if (node.type !== 'VECTOR') return [];
  const paths = subpathsFromPathData(node.pathData ?? '') ?? [];
  return paths
    .filter((path) => !path.closed)
    .map((path) => ringOfPath(path))
    .filter((points): points is Ring => points !== null);
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

/** The most shapes a divide takes: 63 regions at most, one per non-empty subset of them. */
export const DIVIDE_MAX_SHAPES = 6;

/**
 * Divide overlapping shapes into their regions. A region is the part covered by one set of shapes and by no others, so for
 * two shapes there are three: the lower shape alone, the overlap, and the upper shape alone. Each non-empty region becomes a
 * flat vector layer, placed where the lowest of the shapes was, ordered by its lowest shape and then by how many shapes it
 * covers. A region takes the paint of the top-most shape that covers it. The layers are static: unlike a boolean, they keep
 * no operands. The shapes must be two to six layers in the same parent that overlap; anything else is refused and the file
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

/** The result of outlining a stroke: the outline layer made, or why there is none. */
export interface OutlineResult {
  file: PigmaFile;
  nodeId: string | null;
  reason?: string;
}

/**
 * Points around a disc: the round join at a vertex of the stroke. The samples are turned off the axes by half a step, plus a
 * small offset: a sample on an axis lands exactly on the tangent of an axis-aligned edge, and coincident edges make the polygon
 * boolean fail.
 */
const JOIN_SAMPLES = 32;
/** Phases to try, in turn, if the union of a band fails: a different phase moves every sample off the edges it had met. */
const JOIN_PHASES = [Math.PI / JOIN_SAMPLES + 0.0137, Math.PI / JOIN_SAMPLES + 0.1123, Math.PI / JOIN_SAMPLES + 0.2719];

function discRing(x: number, y: number, radius: number, phase: number): Ring {
  const ring: Ring = [];
  for (let step = 0; step < JOIN_SAMPLES; step += 1) {
    const angle = (step / JOIN_SAMPLES) * Math.PI * 2 + phase;
    ring.push([x + Math.cos(angle) * radius, y + Math.sin(angle) * radius]);
  }
  return ring;
}

/**
 * The band of half-width `halfWidth` around closed rings: a quad along each edge, and a disc at each vertex, so every join is
 * round whatever the layer's join setting. The union of the pieces is the band.
 */
function strokeBand(lines: StrokeLine[], halfWidth: number, phase: number, join: StrokeJoin, miterLimit: number): Ring[][] {
  const pieces: Ring[][][] = [];
  for (const { points: given, closed, cap } of lines) {
    // A square cap extends an open line's ends by the half width; a round cap rounds them off.
    const points = closed ? given : squareEnds(given, cap === 'SQUARE' ? halfWidth : 0);
    const count = points.length;
    const edges = closed ? count : count - 1;
    for (let index = 0; index < edges; index += 1) {
      const [x0, y0] = points[index]!;
      const [x1, y1] = points[(index + 1) % count]!;
      const length = Math.hypot(x1 - x0, y1 - y0);
      if (length === 0) continue;
      const nx = (-(y1 - y0) / length) * halfWidth;
      const ny = ((x1 - x0) / length) * halfWidth;
      pieces.push([[[[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]]]]);
    }
    // A vertex where the line turns is joined on its outer side: a round join is a disc, a bevel or miter is a wedge. The ends
    // of an open line are capped instead: a round cap is a disc.
    points.forEach((vertex, index) => {
      const joins = closed || (index > 0 && index < count - 1);
      if (!joins) {
        if (cap === 'ROUND') pieces.push([[discRing(vertex[0], vertex[1], halfWidth, phase)]]);
        return;
      }
      const before = points[(index - 1 + count) % count]!;
      const after = points[(index + 1) % count]!;
      if (join === 'ROUND') {
        pieces.push([[discRing(vertex[0], vertex[1], halfWidth, phase)]]);
        return;
      }
      const wedge = joinOuter(before, vertex, after, halfWidth, join, miterLimit);
      if (wedge) pieces.push([[wedge]]);
    });
  }
  const inputs = pieces as unknown as MultiPolygon[];
  const [first, ...rest] = inputs as [MultiPolygon, ...MultiPolygon[]];
  return polygonClipping.union(first, ...rest) as unknown as Ring[][];
}

/**
 * The outer side of a turn at `vertex`, between the edges from `before` and to `after`, as a piece of the band: a bevel is the
 * triangle across the corner; a miter is the quadrilateral out to the miter point. A miter longer than `miterLimit` times the
 * half width is bevelled instead. A round join is a disc, drawn by the caller, so it returns `null`
 * here. A turn that does not bend, or an edge of no length, has no outer corner to fill.
 */
function joinOuter(before: [number, number], vertex: [number, number], after: [number, number], halfWidth: number, join: StrokeJoin, miterLimit: number): Ring | null {
  if (join === 'ROUND') return null;
  const ax = vertex[0] - before[0];
  const ay = vertex[1] - before[1];
  const bx = after[0] - vertex[0];
  const by = after[1] - vertex[1];
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (la === 0 || lb === 0) return null;
  const d1x = ax / la;
  const d1y = ay / la;
  const d2x = bx / lb;
  const d2y = by / lb;
  const cross = d1x * d2y - d1y * d2x;
  const cos = d1x * d2x + d1y * d2y;
  if (Math.abs(cross) < 1e-9 && cos > 0) return null;
  // The outer side is opposite the way the line bends.
  const side = cross > 0 ? -1 : 1;
  const n1x = -d1y;
  const n1y = d1x;
  const n2x = -d2y;
  const n2y = d2x;
  const ax2 = vertex[0] + side * halfWidth * n1x;
  const ay2 = vertex[1] + side * halfWidth * n1y;
  const bx2 = vertex[0] + side * halfWidth * n2x;
  const by2 = vertex[1] + side * halfWidth * n2y;
  const bevel: Ring = [vertex, [ax2, ay2], [bx2, by2]];
  const denominator = 1 + cos;
  if (join === 'BEVEL' || denominator < 1e-9 || Math.sqrt(2 / denominator) > miterLimit) return bevel;
  const tipX = vertex[0] + (side * halfWidth * (n1x + n2x)) / denominator;
  const tipY = vertex[1] + (side * halfWidth * (n1y + n2y)) / denominator;
  return [vertex, [ax2, ay2], [tipX, tipY], [bx2, by2]];
}

/** An open polyline with its ends pushed out by `extend`, along the direction of its first and last edges. */
function squareEnds(points: Ring, extend: number): Ring {
  if (extend === 0 || points.length < 2) return points;
  const [x0, y0] = points[0]!;
  const [x1, y1] = points[1]!;
  const [xn, yn] = points[points.length - 1]!;
  const [xp, yp] = points[points.length - 2]!;
  const d0 = Math.hypot(x1 - x0, y1 - y0) || 1;
  const dn = Math.hypot(xn - xp, yn - yp) || 1;
  return [
    [x0 - ((x1 - x0) / d0) * extend, y0 - ((y1 - y0) / d0) * extend],
    ...points.slice(1, -1),
    [xn + ((xn - xp) / dn) * extend, yn + ((yn - yp) / dn) * extend],
  ];
}

/** A polyline of the stroke's centre line: closed around a layer's edge, or open for a dash, a line or an open path. */
interface StrokeLine {
  points: Ring;
  closed: boolean;
  cap?: StrokeCap;
}

/**
 * The dashes of a polyline, as open polylines: the stroke's dash pattern (on and off lengths, alternating, as the renderer's
 * stroke-dasharray reads them) is laid along it from its first point. A closed polyline wraps back to its first point; an open
 * one stops at its last. An odd pattern repeats to become even, as SVG does. A pattern with no length is no dashes at all, so the
 * caller draws the solid line instead.
 */
/** The dashes along a path, with the pattern starting `offset` units in: the first dash is cut short by the offset. */
export function dashesOf(points: Ring, pattern: number[], closed: boolean, offset = 0): Ring[] {
  const lengths = pattern.length % 2 === 1 ? [...pattern, ...pattern] : pattern;
  const total = lengths.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) return [];
  const dashes: Ring[] = [];
  let current: Ring | null = null;
  // Start the pattern `offset` units in, wrapped to one period, so an offset of a whole period changes nothing.
  let skip = ((offset % total) + total) % total;
  let index = 0;
  let remaining = lengths[0]!;
  while (skip > 0 && skip >= remaining) {
    skip -= remaining;
    index = (index + 1) % lengths.length;
    remaining = lengths[index]!;
  }
  remaining -= skip;
  const edges = closed ? points.length : points.length - 1;
  for (let edge = 0; edge < edges; edge += 1) {
    const [x0, y0] = points[edge]!;
    const [x1, y1] = points[(edge + 1) % points.length]!;
    const length = Math.hypot(x1 - x0, y1 - y0);
    if (length === 0) continue;
    let along = 0;
    while (along < length) {
      const step = Math.min(remaining, length - along);
      const from = along / length;
      const to = (along + step) / length;
      const on = index % 2 === 0;
      if (on) {
        if (!current) current = [[x0 + (x1 - x0) * from, y0 + (y1 - y0) * from]];
        current.push([x0 + (x1 - x0) * to, y0 + (y1 - y0) * to]);
      }
      along += step;
      remaining -= step;
      if (remaining <= 1e-9) {
        if (on && current && current.length > 1) dashes.push(current);
        current = null;
        index = (index + 1) % lengths.length;
        remaining = lengths[index]!;
      }
    }
  }
  if (current && current.length > 1) dashes.push(current);
  return dashes;
}

/** The result of outlining a stroke: the outline layer made, or why there is none. */
export interface OutlineResult {
  file: PigmaFile;
  nodeId: string | null;
  reason?: string;
}

/**
 * Outline stroke: the stroke of a layer becomes a flat vector layer, filled with the stroke's paint and placed above the layer,
 * and the layer loses its stroke. The layer keeps its fill and its geometry. The band is the stroke's width around the layer's
 * edge, or along its line: for a centred stroke half the width each side, for an inside stroke the whole width inside the edge,
 * and for an outside stroke the whole width outside it. A layer with an open path, or a line, has no inside or outside, so it is
 * always outlined centred. Joins are round whatever the join setting; line ends follow the stroke cap (butt, round or square).
 * Dashes follow the dash pattern. Rectangles, ellipses, lines and vectors are outlined; locked layers and anything else are
 * refused with a reason.
 */
export function outlineStrokeOp(file: PigmaFile, id: string): OutlineResult {
  const refuse = (reason: string): OutlineResult => ({ file, nodeId: null, reason });
  const found = findNode(file.document, id);
  if (!found || found.type === 'DOCUMENT' || found.type === 'CANVAS') return refuse('Select a layer to outline');
  const node = found as SceneNode;
  if (node.locked) return refuse('The layer is locked');
  if (node.type !== 'RECTANGLE' && node.type !== 'ELLIPSE' && node.type !== 'VECTOR' && node.type !== 'LINE') {
    return refuse('Outline stroke works on rectangles, ellipses, lines and vectors');
  }
  const stroke = firstVisibleFill(node.strokes);
  if (!stroke || stroke.type !== 'SOLID') return refuse('The layer needs a visible solid stroke');
  // An arrow cap adds an arrowhead at each open end, and the path itself ends butt.
  const rawCap = node.strokeCap ?? 'NONE';
  const arrow = isArrowCap(rawCap) ? rawCap : null;
  const cap = arrow ? 'NONE' : rawCap;
  const weight = node.strokeWeight ?? 1;
  if (!(weight > 0)) return refuse('The stroke has no width');
  const parentInfo = parentAndIndex(file.document, id);
  if (!parentInfo) return refuse('The layer has no outline');

  // Closed edges become rings; open paths and a line become open polylines, whose ends take the stroke cap.
  let closedRings: Ring[] = [];
  const openLines: StrokeLine[] = [];
  if (node.type === 'LINE') {
    openLines.push({ points: [[0, 0], [node.width, 0]], closed: false, cap });
  } else if (node.type === 'VECTOR') {
    const paths = subpathsFromPathData(node.pathData ?? '');
    if (!paths) return refuse('The layer has no outline');
    for (const path of paths) {
      const points = ringOfPath(path);
      if (!points) continue;
      if (path.closed) closedRings.push(points);
      else openLines.push({ points, closed: false, cap });
    }
  } else {
    const rings = localOutline(node);
    if (!rings) return refuse('The layer has no outline');
    closedRings = rings;
  }
  if (closedRings.length === 0 && openLines.length === 0) return refuse('The layer has no outline');

  // An open line has no inside or outside, so a layer that has one is outlined centred all round.
  const align = openLines.length > 0 ? 'CENTER' : (node.strokeAlign ?? 'CENTER');
  // A centred band reaches half the width each side; an inside or outside band reaches the whole width, then is cut to the layer.
  const reach = align === 'CENTER' ? weight / 2 : weight;
  const shape = align === 'CENTER' || closedRings.length === 0 ? null : (evenOddPolygons(closedRings) as unknown as MultiPolygon);
  // Each closed edge and each open line is drawn solid, or as its dashes when there is a pattern with dashes.
  const pattern = node.dashPattern ?? [];
  const offset = node.dashOffset ?? 0;
  const lines: StrokeLine[] = [];
  for (const ring of closedRings) {
    const dashes = pattern.length > 0 ? dashesOf(ring, pattern, true, offset) : [];
    if (dashes.length > 0) lines.push(...dashes.map((points) => ({ points, closed: false })));
    else lines.push({ points: ring, closed: true });
  }
  // The arms of an arrow line are open lines like the path's, so a dashed stroke dashes them too; the triangles of an equilateral
  // arrow are added to the band instead.
  const arrowheads = arrow ? arrowheadsOf(openLines.map((line) => line.points), arrow, weight) : null;
  const arms: StrokeLine[] = arrowheads ? arrowheads.arms.map((points) => ({ points, closed: false, cap: 'NONE' as StrokeCap })) : [];
  for (const line of [...openLines, ...arms]) {
    const dashes = pattern.length > 0 ? dashesOf(line.points, pattern, false, offset) : [];
    if (dashes.length > 0) lines.push(...dashes.map((points) => ({ points, closed: false })));
    else lines.push(line);
  }

  let band: Ring[][] | null = null;
  const join = node.strokeJoin ?? 'MITER';
  const miterLimit = node.strokeMiterLimit ?? DEFAULT_MITER_LIMIT;
  for (const phase of JOIN_PHASES) {
    try {
      let full = strokeBand(lines, reach, phase, join, miterLimit) as unknown as MultiPolygon;
      if (arrowheads && arrowheads.heads.length > 0) {
        full = polygonClipping.union(full, ...arrowheads.heads.map((head) => [[head]] as unknown as MultiPolygon));
      }
      if (!shape) band = full as unknown as Ring[][];
      else band = (align === 'INSIDE' ? polygonClipping.intersection(full, shape) : polygonClipping.difference(full, shape)) as unknown as Ring[][];
      break;
    } catch {
      // A degenerate union at this phase: try the next one.
    }
  }
  if (!band) return refuse('Outline stroke could not be applied');
  const bounds = boundsOfPolygons(band);
  if (!bounds) return refuse('Outline stroke could not be applied');
  const localised = band.map((polygon) => polygon.map((ring) => ring.map(([x, y]) => [x - bounds.x, y - bounds.y] as [number, number])));
  const outline = {
    ...createShapeNode(file.document, 'RECTANGLE', 0, 0, Math.max(1, bounds.width), Math.max(1, bounds.height)),
    type: 'VECTOR',
    name: `${node.name} outline`,
    pathData: polygonsToPathData(localised),
    windingRule: 'EVENODD',
    fills: [{ ...stroke }],
    strokes: [],
    effects: [],
    opacity: node.opacity,
    // The outline sits where the layer is: its bounds offset by the layer's own transform.
    transform: multiply(node.transform, translate(bounds.x, bounds.y)),
  } as unknown as SceneNode;

  let document = updateNode(file.document, id, (current) => ({ ...current, strokes: [] }) as AnyNode);
  document = insertChild(document, parentInfo.parent.id, outline, parentInfo.index + 1);
  return { file: { ...file, document, lastModified: Date.now() }, nodeId: outline.id };
}
