import type { AnyNode, Rect } from './types';
import { hasChildren } from './types';
import { absoluteBounds, findNode, findParent } from './tree';

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

/** Alignment candidates on both axes: sibling edges/centres plus the parent box. */
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

/** Snap a single edge (resize handles) to nearby targets. */
export function snapValue(root: AnyNode, movingIds: Iterable<string>, value: number, axis: 'x' | 'y', options: SnapOptions): number {
  const ids = new Set(movingIds);
  const first = [...ids][0];
  if (!first) return value;
  const parent = findParent(root, first);
  const { x, y } = collectTargets(root, ids, parent ? parent.id : null);
  const targets = axis === 'x' ? x : y;
  let best: number | null = null;
  for (const target of targets) {
    const delta = target.value - value;
    if (Math.abs(delta) > options.threshold) continue;
    if (best === null || Math.abs(delta) < Math.abs(best)) best = delta;
  }
  return best === null ? value : value + best;
}
