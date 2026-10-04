import type { AnyNode, InstanceNode, NodeOverride, SceneNode } from './types';
import { hasChildren } from './types';
import { updateNode } from './tree';

/**
 * Component instances.
 *
 * An instance owns a materialized copy of its component's subtree so rendering,
 * hit testing and export need no special cases. `syncInstances` rebuilds that
 * copy from the current component and re-applies the instance's overrides, which
 * is how edits to a component propagate to every instance of it.
 *
 * Instance child ids are derived deterministically (`<instanceId>~<componentNodeId>`),
 * so overrides — keyed by the *component* node id — stay valid across syncs.
 */

export const INSTANCE_ID_SEPARATOR = '~';

export function instanceChildId(instanceId: string, componentNodeId: string): string {
  return `${instanceId}${INSTANCE_ID_SEPARATOR}${componentNodeId}`;
}

/** Component node id behind an instance child id, or null when it is not one. */
export function componentNodeIdOf(childId: string): string | null {
  const index = childId.indexOf(INSTANCE_ID_SEPARATOR);
  return index < 0 ? null : childId.slice(index + INSTANCE_ID_SEPARATOR.length);
}

export function applyOverride(node: SceneNode, override: NodeOverride | undefined): SceneNode {
  if (!override) return node;
  const next = { ...node } as SceneNode;
  if (override.name !== undefined) next.name = override.name;
  if (override.visible !== undefined) next.visible = override.visible;
  if (override.locked !== undefined) next.locked = override.locked;
  if (override.opacity !== undefined) next.opacity = override.opacity;
  if (override.blendMode !== undefined) next.blendMode = override.blendMode;
  if (override.fills !== undefined) next.fills = override.fills;
  if (override.strokes !== undefined) next.strokes = override.strokes;
  if (override.strokeWeight !== undefined) next.strokeWeight = override.strokeWeight;
  if (override.cornerRadius !== undefined) next.cornerRadius = override.cornerRadius;
  if (override.effects !== undefined) next.effects = override.effects;
  if (override.width !== undefined) next.width = override.width;
  if (override.height !== undefined) next.height = override.height;
  if (override.x !== undefined || override.y !== undefined) {
    next.transform = {
      ...next.transform,
      tx: override.x !== undefined ? override.x : next.transform.tx,
      ty: override.y !== undefined ? override.y : next.transform.ty,
    };
  }
  if (override.characters !== undefined && next.type === 'TEXT') {
    return { ...next, characters: override.characters };
  }
  return next;
}

/** Rebuild an instance's subtree from its component, applying overrides. */
function materializeInstance(instance: InstanceNode, component: SceneNode): SceneNode[] {
  const overrides = instance.overrides ?? {};
  const build = (node: SceneNode): SceneNode => {
    const copy = { ...node, id: instanceChildId(instance.id, node.id) } as SceneNode;
    const withOverride = applyOverride(copy, overrides[node.id]);
    if (hasChildren(node)) {
      const children = (node.children as SceneNode[]).map(build);
      return { ...(withOverride as typeof node), children };
    }
    return withOverride;
  };
  if (!hasChildren(component)) return [];
  return (component.children as SceneNode[]).map(build);
}

function nodesEquivalent(a: SceneNode, b: SceneNode): boolean {
  if (a === b) return true;
  if (
    a.id !== b.id ||
    a.name !== b.name ||
    a.type !== b.type ||
    a.visible !== b.visible ||
    a.locked !== b.locked ||
    a.opacity !== b.opacity ||
    a.width !== b.width ||
    a.height !== b.height ||
    a.transform.a !== b.transform.a ||
    a.transform.b !== b.transform.b ||
    a.transform.c !== b.transform.c ||
    a.transform.d !== b.transform.d ||
    a.transform.tx !== b.transform.tx ||
    a.transform.ty !== b.transform.ty ||
    a.fills !== b.fills ||
    a.strokes !== b.strokes
  ) {
    return false;
  }
  if (a.type === 'TEXT' && b.type === 'TEXT' && a.characters !== b.characters) return false;
  const aHas = hasChildren(a);
  const bHas = hasChildren(b);
  if (aHas !== bHas) return false;
  if (aHas && bHas) {
    const aChildren = a.children as SceneNode[];
    const bChildren = b.children as SceneNode[];
    if (aChildren.length !== bChildren.length) return false;
    return aChildren.every((child, index) => nodesEquivalent(child, bChildren[index] as SceneNode));
  }
  return true;
}

/**
 * Refresh every instance in the tree from its component. Returns the same node
 * when nothing changed, so this is safe to run after every edit.
 */
export function syncInstances<T extends AnyNode>(root: T): T {
  // Resolve components through one index, built lazily on the first instance so
  // a document with no instances pays no index walk at all. Looking each
  // instance's componentId up with `findNode` walked the whole tree per
  // instance, so settling a design-system document was O(instances x nodes) and
  // grew superlinearly. First id wins, matching `findNode`'s depth-first order,
  // and the index is rooted at `root` (the document), so a component on another
  // page than its instance still resolves.
  let index: Map<string, AnyNode> | null = null;
  const lookup = (id: string): AnyNode | undefined => {
    if (!index) {
      index = new Map<string, AnyNode>();
      indexById(root, index);
    }
    return index.get(id);
  };
  return syncWithin(root, lookup);
}

function indexById(node: AnyNode, index: Map<string, AnyNode>): void {
  if (!index.has(node.id)) index.set(node.id, node);
  if (!hasChildren(node)) return;
  for (const child of node.children as AnyNode[]) indexById(child, index);
}

/**
 * `lookup` resolves a component id through the document-rooted index, built on
 * first use: components can live on a different page than the instance, so
 * lookups must not be limited to the local subtree.
 */
function syncWithin<T extends AnyNode>(root: T, lookup: (id: string) => AnyNode | undefined): T {
  if (!hasChildren(root)) return root;
  const source = root.children as AnyNode[];
  let changed = false;
  const children = source.map((child) => {
    const synced = syncWithin(child, lookup);
    if (synced !== child) changed = true;
    return synced;
  });

  const node = changed ? ({ ...root, children } as T) : root;
  if (node.type !== 'INSTANCE') return node;

  const instance = node as unknown as InstanceNode;
  const component = lookup(instance.componentId);
  if (!component || !hasChildren(component) || component.type === 'DOCUMENT' || component.type === 'CANVAS') {
    return node;
  }
  const rebuilt = materializeInstance(instance, component as SceneNode);
  const current = (instance.children ?? []) as SceneNode[];
  const same =
    current.length === rebuilt.length && current.every((child, index) => nodesEquivalent(child, rebuilt[index] as SceneNode));
  if (same) return node;
  return { ...instance, children: rebuilt } as unknown as T;
}

export interface InstanceAncestry {
  instance: InstanceNode;
  componentNodeId: string;
  /** Path of component node ids from the instance root to the target. */
  componentPath: string[];
}

/**
 * Locate the instance that owns `nodeId`, walking up the tree. Returns null when
 * the node is not inside an instance.
 */
export function instanceAncestryOf(root: AnyNode, nodeId: string): InstanceAncestry | null {
  const path: AnyNode[] = [];
  const find = (node: AnyNode, trail: AnyNode[]): AnyNode[] | null => {
    if (node.id === nodeId) return [...trail, node];
    if (!hasChildren(node)) return null;
    for (const child of node.children) {
      const found = find(child, [...trail, node]);
      if (found) return found;
    }
    return null;
  };
  const found = find(root, []);
  if (!found) return null;
  path.push(...found);

  const instanceIndex = path.findIndex((node) => node.type === 'INSTANCE');
  if (instanceIndex < 0) return null;
  const instance = path[instanceIndex] as InstanceNode;
  const componentPath: string[] = [];
  for (const node of path.slice(instanceIndex + 1)) {
    const componentNodeId = componentNodeIdOf(node.id) ?? node.id;
    componentPath.push(componentNodeId);
  }
  const last = componentPath[componentPath.length - 1];
  if (!last) return null;
  return { instance, componentNodeId: last, componentPath };
}

/** Write an override onto the instance that owns `nodeId`. */
export function withOverride<T extends AnyNode>(
  root: T,
  instanceId: string,
  componentNodeId: string,
  patch: NodeOverride,
): T {
  return updateNode(root, instanceId, (node) => {
    if (node.type !== 'INSTANCE') return node;
    const instance = node as InstanceNode;
    const overrides = { ...(instance.overrides ?? {}) };
    overrides[componentNodeId] = { ...(overrides[componentNodeId] ?? {}), ...patch };
    return { ...instance, overrides } as AnyNode;
  }) as T;
}

