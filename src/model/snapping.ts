import type { AnyNode, AutoLayout, Rect } from './types';
import { hasChildren } from './types';
import { absoluteBounds, findNode, findParent, findPath } from './tree';

/**
 * Snapping and smart guides.
 *
 * Given the box a drag would produce, this finds the closest alignment to any
 * sibling's edges/centres (plus the parent frame) and to the pixel grid, and
 * returns both the corrected delta and the guides to draw. Pure: the canvas
 * calls it on every pointer move and renders whatever comes back.
 */

export interface SnapTarget {
  /** Absolute coordinate on the axis. */
  value: number;
  /** Which part of the other node produced it, for guide bookkeeping. */
  kind: 'edge' | 'center';
  /** Extent of the other node on the cross axis, used to draw the guide. */
  span: [number, number];
}

export interface Guide {
  axis: 'x' | 'y';
  position: number;
  /** Cross-axis extent of the guide line, in world coordinates. */
  from: number;
  to: number;
}

export interface SnapOptions {
  /** Distance in *world* units (screen threshold / zoom) that still snaps. */
  threshold: number;
  snapToObjects: boolean;
  snapToGrid: boolean;
  gridSize: number;
  /** The page's ruler guides, as snap targets when snapping to objects is on. */
  guides?: { x: number[]; y: number[] };
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: Guide[];
}

export const NO_SNAP: SnapResult = { dx: 0, dy: 0, guides: [] };

function boundsOfNode(root: AnyNode, node: AnyNode): Rect | null {
  return absoluteBounds(root, node.id);
}

/**
 * Alignment candidates on both axes: sibling edges and centres, then the parent frame's own edges and centre, and, when the
 * frame has auto layout, the lines its padding leaves inside it. Only a frame is a parent here: a page has no box to align to,
 * and a group's box is its children's, so a group's edges would only repeat its children's. A drag never reaches the padding
 * lines, since it reorders a child of an auto layout frame rather than moving it; a resize does.
 */
function collectTargets(root: AnyNode, movingIds: Set<string>, movingParentId: string | null): { x: SnapTarget[]; y: SnapTarget[] } {
  const x: SnapTarget[] = [];
  const y: SnapTarget[] = [];
  const parent = movingParentId ? findNode(root, movingParentId) : null;
  const container = parent && hasChildren(parent) ? parent : null;
  const candidates = container ? (container.children as AnyNode[]) : [];

  for (const candidate of candidates) {
    if (movingIds.has(candidate.id)) continue;
    const bounds = boundsOfNode(root, candidate);
    if (!bounds) continue;
    x.push({ value: bounds.x, kind: 'edge', span: [bounds.y, bounds.y + bounds.height] });
    x.push({ value: bounds.x + bounds.width / 2, kind: 'center', span: [bounds.y, bounds.y + bounds.height] });
    x.push({ value: bounds.x + bounds.width, kind: 'edge', span: [bounds.y, bounds.y + bounds.height] });
    y.push({ value: bounds.y, kind: 'edge', span: [bounds.x, bounds.x + bounds.width] });
    y.push({ value: bounds.y + bounds.height / 2, kind: 'center', span: [bounds.x, bounds.x + bounds.width] });
    y.push({ value: bounds.y + bounds.height, kind: 'edge', span: [bounds.x, bounds.x + bounds.width] });
  }

  // Every frame that contains the moving node is a target, the parent's and each enclosing frame's edges and centre. The
  // parent's auto layout padding is added too, since only the parent's children are laid out against it.
  const chain = movingParentId ? findPath(root, movingParentId) ?? [] : [];
  for (const frame of chain) {
    if (frame.type !== 'FRAME') continue;
    const box = boundsOfNode(root, frame);
    if (!box) continue;
    const xSpan: [number, number] = [box.y, box.y + box.height];
    const ySpan: [number, number] = [box.x, box.x + box.width];
    x.push({ value: box.x, kind: 'edge', span: xSpan });
    x.push({ value: box.x + box.width / 2, kind: 'center', span: xSpan });
    x.push({ value: box.x + box.width, kind: 'edge', span: xSpan });
    y.push({ value: box.y, kind: 'edge', span: ySpan });
    y.push({ value: box.y + box.height / 2, kind: 'center', span: ySpan });
    y.push({ value: box.y + box.height, kind: 'edge', span: ySpan });
    const layout = frame.id === container?.id ? (frame as { autoLayout?: AutoLayout }).autoLayout : undefined;
    if (layout) {
      x.push({ value: box.x + (layout.paddingLeft ?? 0), kind: 'edge', span: xSpan });
      x.push({ value: box.x + box.width - (layout.paddingRight ?? 0), kind: 'edge', span: xSpan });
      y.push({ value: box.y + (layout.paddingTop ?? 0), kind: 'edge', span: ySpan });
      y.push({ value: box.y + box.height - (layout.paddingBottom ?? 0), kind: 'edge', span: ySpan });
    }
  }
  return { x, y };
}

interface AxisSnap {
  delta: number;
  guide: Guide | null;
}

function snapAxis(
  moving: [number, number, number],
  targets: SnapTarget[],
  axis: 'x' | 'y',
  movingCross: [number, number],
  threshold: number,
): AxisSnap {
  let best: { delta: number; target: SnapTarget; movingValue: number } | null = null;
  for (const target of targets) {
    for (const value of moving) {
      const delta = target.value - value;
      if (Math.abs(delta) > threshold) continue;
      if (!best || Math.abs(delta) < Math.abs(best.delta)) best = { delta, target, movingValue: value };
    }
  }
  if (!best) return { delta: 0, guide: null };
  const guide: Guide = {
    axis,
    position: best.target.value,
    from: Math.min(best.target.span[0], movingCross[0]),
    to: Math.max(best.target.span[1], movingCross[1]),
  };
  return { delta: best.delta, guide };
}

function snapToGridValue(value: number, gridSize: number, threshold: number): number {
  if (gridSize <= 0) return 0;
  const nearest = Math.round(value / gridSize) * gridSize;
  const delta = nearest - value;
  return Math.abs(delta) <= threshold ? delta : 0;
}

/**
 * Compute the snapped delta for a proposed move. `proposed` is the box the drag
 * would produce *before* snapping, in world coordinates.
 */
export function computeSnap(
  root: AnyNode,
  movingIds: Iterable<string>,
  proposed: Rect,
  options: SnapOptions,
): SnapResult {
  const ids = new Set(movingIds);
  if (ids.size === 0) return NO_SNAP;
  const first = [...ids][0];
  if (!first) return NO_SNAP;
  const parent = findParent(root, first);

  let dx = 0;
  let dy = 0;
  const guides: Guide[] = [];

  if (options.snapToObjects) {
    const { x, y } = collectTargets(root, ids, parent ? parent.id : null);
    // A ruler guide is an edge that spans the whole page, so the moving box snaps to it on that axis.
    const span: [number, number] = [-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
    for (const offset of options.guides?.x ?? []) x.push({ value: offset, kind: 'edge', span });
    for (const offset of options.guides?.y ?? []) y.push({ value: offset, kind: 'edge', span });
    const xSnap = snapAxis([proposed.x, proposed.x + proposed.width / 2, proposed.x + proposed.width], x, 'x', [proposed.y, proposed.y + proposed.height], options.threshold);
    const ySnap = snapAxis([proposed.y, proposed.y + proposed.height / 2, proposed.y + proposed.height], y, 'y', [proposed.x, proposed.x + proposed.width], options.threshold);
    dx += xSnap.delta;
    dy += ySnap.delta;
    if (xSnap.guide) guides.push(xSnap.guide);
    if (ySnap.guide) guides.push(ySnap.guide);
  }

  if (options.snapToGrid && options.gridSize > 0) {
    dx += snapToGridValue(proposed.x + dx, options.gridSize, options.threshold);
    dy += snapToGridValue(proposed.y + dy, options.gridSize, options.threshold);
  }

  if (dx === 0 && dy === 0 && guides.length === 0) return NO_SNAP;
  return { dx, dy, guides };
}

/**
 * Snap one edge of a resize to the nearest target on its axis, with the guide to draw. The candidates are the ones a move
 * uses: siblings, the parent frame, and the ruler guides. The grid applies when no object is in reach, as for a move.
 * The guide runs across the moving extent on the other axis: `across` when given (a selection's box), else the first node's.
 */
export function snapEdge(
  root: AnyNode,
  movingIds: Iterable<string>,
  value: number,
  axis: 'x' | 'y',
  options: SnapOptions,
  across?: Rect,
): { value: number; guide: Guide | null } {
  const ids = new Set(movingIds);
  const first = [...ids][0];
  if (!first) return { value, guide: null };
  const parent = findParent(root, first);
  // The guide runs across the moving extent: the given box (a selection's) or else the first node's own.
  const box = across ?? boundsOfNode(root, findNode(root, first)!);
  if (!box) return { value, guide: null };
  const cross: [number, number] = axis === 'x' ? [box.y, box.y + box.height] : [box.x, box.x + box.width];
  const { x, y } = collectTargets(root, ids, parent ? parent.id : null);
  const targets = axis === 'x' ? x : y;
  if (options.snapToObjects) {
    const span: [number, number] = [-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
    for (const offset of (axis === 'x' ? options.guides?.x : options.guides?.y) ?? []) targets.push({ value: offset, kind: 'edge', span });
    // The one edge is passed three times, as snapAxis takes the three points of a box, and the nearest target wins.
    const snap = snapAxis([value, value, value], targets, axis, cross, options.threshold);
    if (snap.guide) return { value: value + snap.delta, guide: snap.guide };
  }
  if (options.snapToGrid && options.gridSize > 0) return { value: value + snapToGridValue(value, options.gridSize, options.threshold), guide: null };
  return { value, guide: null };
}

/** Snap a single edge (resize handles) to nearby targets. */
export function snapValue(root: AnyNode, movingIds: Iterable<string>, value: number, axis: 'x' | 'y', options: SnapOptions): number {
  return snapEdge(root, movingIds, value, axis, options).value;
}
