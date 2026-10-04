import type { AnyChild, AnyNode, ParentNode, Rect, SceneNode, Transform } from './types';
import { hasChildren } from './types';
import { IDENTITY, applyToPoint, boundsOf, invert, multiply } from './matrix';

/** Depth-first walk over the subtree rooted at `root` (inclusive). */
export function walk(
  root: AnyNode,
  visit: (node: AnyNode, parent: ParentNode | null) => void,
  parent: ParentNode | null = null,
): void {
  visit(root, parent);
  if (!hasChildren(root)) return;
  for (const child of root.children) walk(child, visit, root);
}

export function findNode(root: AnyNode, id: string): AnyNode | null {
  if (root.id === id) return root;
  if (!hasChildren(root)) return null;
  for (const child of root.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

/** Ancestor chain from the root down to (and including) `id`. */
export function findPath(root: AnyNode, id: string): AnyNode[] | null {
  if (root.id === id) return [root];
  if (!hasChildren(root)) return null;
  for (const child of root.children) {
    const sub = findPath(child, id);
    if (sub) return [root, ...sub];
  }
  return null;
}

export function findParent(root: AnyNode, id: string): ParentNode | null {
  const path = findPath(root, id);
  if (!path || path.length < 2) return null;
  const parent = path[path.length - 2];
  return parent && hasChildren(parent) ? parent : null;
}

export function parentAndIndex(root: AnyNode, id: string): { parent: ParentNode; index: number } | null {
  const parent = findParent(root, id);
  if (!parent) return null;
  const index = parent.children.findIndex((c) => c.id === id);
  return index < 0 ? null : { parent, index };
}

export function isDescendant(root: AnyNode, ancestorId: string, nodeId: string): boolean {
  if (ancestorId === nodeId) return false;
  const ancestor = findNode(root, ancestorId);
  if (!ancestor) return false;
  return findPath(ancestor, nodeId) !== null;
}

/**
 * Immutable node update with structural sharing: only nodes on the path to the
 * target are cloned, so React subtrees for untouched branches keep identity.
 */
export function updateNode<T extends AnyNode>(root: T, id: string, updater: (node: AnyNode) => AnyNode): T {
  if (root.id === id) return updater(root) as T;
  if (!hasChildren(root)) return root;
  const source = root.children as AnyChild[];
  let changed = false;
  const children = source.map((child) => {
    const next = updateNode(child, id, updater);
    if (next !== child) changed = true;
    return next;
  });
  if (!changed) return root;
  return { ...root, children } as T;
}

export function insertChild<T extends AnyNode>(
  root: T,
  parentId: string,
  child: AnyChild,
  index = Number.MAX_SAFE_INTEGER,
): T {
  return updateNode(root, parentId, (node) => {
    if (!hasChildren(node)) return node;
    const children = [...(node.children as AnyChild[])];
    const at = Math.max(0, Math.min(index, children.length));
    children.splice(at, 0, child);
    return { ...node, children } as AnyNode;
  }) as T;
}

export function removeNode<T extends AnyNode>(root: T, id: string): { root: T; removed: SceneNode | null } {
  const target = findNode(root, id);
  if (!target || target.type === 'DOCUMENT' || target.type === 'CANVAS') return { root, removed: null };
  const parent = findParent(root, id);
  if (!parent) return { root, removed: null };
  const next = updateNode(root, parent.id, (node) => {
    if (!hasChildren(node)) return node;
    return { ...node, children: (node.children as AnyChild[]).filter((c) => c.id !== id) } as AnyNode;
  }) as T;
  return { root: next, removed: target as SceneNode };
}

/** Remove many nodes at once, ignoring ids whose parent disappeared meanwhile. */
export function removeNodes<T extends AnyNode>(root: T, ids: Iterable<string>): { root: T; removed: SceneNode[] } {
  let next = root;
  const removed: SceneNode[] = [];
  for (const id of ids) {
    const res = removeNode(next, id);
    next = res.root;
    if (res.removed) removed.push(res.removed);
  }
  return { root: next, removed };
}

/**
 * Reparent `id` under `parentId` at `index`, rebasing the node's transform so it
 * keeps its on-screen position (Figma's `appendChild` semantics).
 */
export function moveNode<T extends AnyNode>(root: T, id: string, parentId: string, index = Number.MAX_SAFE_INTEGER): T {
  if (id === parentId || isDescendant(root, id, parentId)) return root;
  const node = findNode(root, id);
  if (!node || node.type === 'DOCUMENT' || node.type === 'CANVAS') return root;
  const world = worldTransform(root, id);
  const { root: without, removed } = removeNode(root, id);
  if (!removed) return root;
  const parentWorld = worldTransform(without, parentId);
  const local = multiply(invert(parentWorld), world);
  return insertChild(without, parentId, { ...removed, transform: local }, index);
}

/** Absolute transform of `id` relative to the page root. */
export function worldTransform(root: AnyNode, id: string): Transform {
  const path = findPath(root, id);
  if (!path) return { ...IDENTITY };
  let acc: Transform = { ...IDENTITY };
  for (const node of path) {
    if (node.type === 'DOCUMENT' || node.type === 'CANVAS') continue;
    acc = multiply(acc, node.transform);
  }
  return acc;
}

/** Absolute transform of a node's parent (used to convert world deltas to local). */
export function parentWorldTransform(root: AnyNode, id: string): Transform {
  const parent = findParent(root, id);
  return parent ? worldTransform(root, parent.id) : { ...IDENTITY };
}

export function absoluteBounds(root: AnyNode, id: string): Rect | null {
  const node = findNode(root, id);
  if (!node) return null;
  return boundsOf(worldTransform(root, id), node.width, node.height);
}

export function unionRects(a: Rect | null, b: Rect): Rect {
  if (!a) return b;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

/** Union of absolute bounds for a set of nodes. */
export function boundsOfNodes(root: AnyNode, ids: Iterable<string>): Rect | null {
  let acc: Rect | null = null;
  for (const id of ids) {
    const b = absoluteBounds(root, id);
    if (b) acc = unionRects(acc, b);
  }
  return acc;
}

/** Every node in the subtree, excluding the subtree root itself. */
export function descendants(node: AnyNode): AnyChild[] {
  const out: AnyChild[] = [];
  if (!hasChildren(node)) return out;
  for (const child of node.children) {
    out.push(child);
    out.push(...descendants(child));
  }
  return out;
}

export function nodeMap(root: AnyNode): Map<string, AnyNode> {
  const map = new Map<string, AnyNode>();
  walk(root, (node) => {
    map.set(node.id, node);
  });
  return map;
}

/**
 * True when the point (in `space` coordinates) is inside the node's box.
 * Bounds test in the node's local space — correct for rotated nodes.
 */
export function hitTestBox(node: AnyNode, space: Transform, x: number, y: number, tolerance = 0): boolean {
  const local = applyToPoint(invert(space), x, y);
  return (
    local.x >= -tolerance &&
    local.y >= -tolerance &&
    local.x <= node.width + tolerance &&
    local.y <= node.height + tolerance
  );
}

export function localPoint(space: Transform, x: number, y: number): { x: number; y: number } {
  return applyToPoint(invert(space), x, y);
}

