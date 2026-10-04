import type { PigmaFile, Rect, SceneNode } from './types';
import { absoluteBounds, boundsOfNodes, findNode } from './tree';

/**
 * Dev-mode redlines (M14).
 *
 * Pure measurement maths for the canvas overlays: a node's own size, the gaps to
 * its parent, and the distances to the nearest sibling on each side. Everything
 * is computed in scene coordinates from absolute bounds, so rotated and nested
 * nodes measure the same way Figma reports them. The canvas draws these values;
 * exports never see them.
 */

export interface RedlineGap {
  /** Distance in scene units (always >= 0). */
  distance: number;
  /** Where the measurement starts and ends, for the dimension line. */
  from: number;
  to: number;
}

export interface RedlineParentSpacing {
  left: RedlineGap | null;
  right: RedlineGap | null;
  top: RedlineGap | null;
  bottom: RedlineGap | null;
}

export interface RedlineSibling {
  id: string;
  name: string;
  /** Axis the neighbour sits on, and the clear distance to it. */
  side: 'left' | 'right' | 'top' | 'bottom';
  distance: number;
  /** Dimension line endpoints in scene coordinates. */
  from: number;
  to: number;
  /** Cross-axis position of the measurement line. */
  at: number;
}

export interface Redlines {
  id: string;
  bounds: Rect;
  width: number;
  height: number;
  parent: RedlineParentSpacing | null;
  siblings: RedlineSibling[];
}

function gap(from: number, to: number): RedlineGap {
  return { distance: Math.abs(to - from), from, to };
}

/** Siblings of `node` inside its parent (the node itself excluded). */
function siblingsOf(file: PigmaFile, id: string): SceneNode[] {
  const node = findNode(file.document, id);
  if (!node) return [];
  const parent = findNode(file.document, parentIdOf(file, id) ?? '');
  if (!parent || !('children' in parent) || !Array.isArray(parent.children)) return [];
  return (parent.children as SceneNode[]).filter((child) => child.id !== id);
}

function parentIdOf(file: PigmaFile, id: string): string | null {
  const walk = (node: SceneNode, parent: string | null): string | null => {
    if (node.id === id) return parent;
    if (!('children' in node) || !Array.isArray(node.children)) return null;
    for (const child of node.children as SceneNode[]) {
      const found = walk(child, node.id);
      if (found !== null) return found;
    }
    return null;
  };
  return walk(file.document as unknown as SceneNode, null);
}

/**
 * Measure a node: size, spacing to its parent's inner edges, and the nearest
 * sibling on each side.
 */
export function redlinesFor(file: PigmaFile, id: string): Redlines | null {
  const node = findNode(file.document, id);
  if (!node || node.type === 'DOCUMENT' || node.type === 'CANVAS') return null;
  const bounds = absoluteBounds(file.document, id);
  if (!bounds) return null;

  const parentId = parentIdOf(file, id);
  const parent = parentId ? findNode(file.document, parentId) : null;
  let parentSpacing: RedlineParentSpacing | null = null;
  if (parent && parent.type !== 'DOCUMENT' && parent.type !== 'CANVAS') {
    const parentBounds = absoluteBounds(file.document, parentId!);
    if (parentBounds) {
      parentSpacing = {
        left: gap(parentBounds.x, bounds.x),
        right: gap(bounds.x + bounds.width, parentBounds.x + parentBounds.width),
        top: gap(parentBounds.y, bounds.y),
        bottom: gap(bounds.y + bounds.height, parentBounds.y + parentBounds.height),
      };
    }
  }

  const siblings: RedlineSibling[] = [];
  for (const sibling of siblingsOf(file, id)) {
    const siblingBounds = absoluteBounds(file.document, sibling.id);
    if (!siblingBounds) continue;
    const overlapsY = bounds.y < siblingBounds.y + siblingBounds.height && siblingBounds.y < bounds.y + bounds.height;
    const overlapsX = bounds.x < siblingBounds.x + siblingBounds.width && siblingBounds.x < bounds.x + bounds.width;
    if (overlapsY) {
      if (siblingBounds.x + siblingBounds.width <= bounds.x) {
        siblings.push({
          id: sibling.id,
          name: sibling.name,
          side: 'left',
          distance: bounds.x - (siblingBounds.x + siblingBounds.width),
          from: siblingBounds.x + siblingBounds.width,
          to: bounds.x,
          at: bounds.y + bounds.height / 2,
        });
      } else if (siblingBounds.x >= bounds.x + bounds.width) {
        siblings.push({
          id: sibling.id,
          name: sibling.name,
          side: 'right',
          distance: siblingBounds.x - (bounds.x + bounds.width),
          from: bounds.x + bounds.width,
          to: siblingBounds.x,
          at: bounds.y + bounds.height / 2,
        });
      }
    }
    if (overlapsX) {
      if (siblingBounds.y + siblingBounds.height <= bounds.y) {
        siblings.push({
          id: sibling.id,
          name: sibling.name,
          side: 'top',
          distance: bounds.y - (siblingBounds.y + siblingBounds.height),
          from: siblingBounds.y + siblingBounds.height,
          to: bounds.y,
          at: bounds.x + bounds.width / 2,
        });
      } else if (siblingBounds.y >= bounds.y + bounds.height) {
        siblings.push({
          id: sibling.id,
          name: sibling.name,
          side: 'bottom',
          distance: siblingBounds.y - (bounds.y + bounds.height),
          from: bounds.y + bounds.height,
          to: siblingBounds.y,
          at: bounds.x + bounds.width / 2,
        });
      }
    }
  }

  // Keep the nearest neighbour per side: those are the measurements that matter.
  const nearest = new Map<RedlineSibling['side'], RedlineSibling>();
  for (const sibling of siblings) {
    const current = nearest.get(sibling.side);
    if (!current || sibling.distance < current.distance) nearest.set(sibling.side, sibling);
  }

  return {
    id,
    bounds,
    width: bounds.width,
    height: bounds.height,
    parent: parentSpacing,
    siblings: [...nearest.values()].sort((a, b) => a.side.localeCompare(b.side)),
  };
}

/** Distance between two nodes' bounds, for multi-selection spacing readouts. */
export function distanceBetween(file: PigmaFile, a: string, b: string): number | null {
  const first = absoluteBounds(file.document, a);
  const second = absoluteBounds(file.document, b);
  if (!first || !second) return null;
  const union = boundsOfNodes(file.document, [a, b]);
  if (!union) return null;
  const dx = Math.max(0, Math.max(first.x - (second.x + second.width), second.x - (first.x + first.width)));
  const dy = Math.max(0, Math.max(first.y - (second.y + second.height), second.y - (first.y + first.height)));
  return Math.round(Math.hypot(dx, dy) * 100) / 100;
}

/** Round a measurement for display (Figma shows whole scene units). */
export function formatMeasure(value: number): string {
  return String(Math.round(value));
}
