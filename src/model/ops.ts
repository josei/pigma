import type {
  AnyNode,
  AutoLayout,
  BaseNode,
  ChildrenMixin,
  Constraints,
  ContainerNode,
  Effect,
  LayoutGrid,
  Node,
  OverflowDirection,
  Paint,
  PigmaFile,
  SceneNode,
  StrokeAlign,
  Transform,
} from './types';
import { hasChildren } from './types';
import {
  boundsOf,
  invert,
  multiply,
  rotationOf,
  withRotation,
} from './matrix';
import type { Rect } from './types';
import {
  absoluteBounds,
  boundsOfNodes,
  findNode,
  findParent,
  findPath,
  insertChild,
  moveNode,
  parentAndIndex,
  parentWorldTransform,
  removeNode,
  removeNodes,
  updateNode,
  worldTransform,
} from './tree';
import { nextNodeId } from './ids';
import { autoLayoutOf } from './autoLayout';
import { applyConstraints } from './constraints';
import { clampHeight, clampSize, clampWidth, limitsOf } from './sizing';

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

function touch(file: PigmaFile): PigmaFile {
  return { ...file, lastModified: Date.now() };
}

/** Convert a world-space delta into a delta expressed in `space`'s basis (no translation). */
function deltaInSpace(space: Transform, dx: number, dy: number): { x: number; y: number } {
  const inv = invert(space);
  return { x: inv.a * dx + inv.c * dy, y: inv.b * dx + inv.d * dy };
}

/** Move nodes by a world-space delta (correct under rotated/scaled parents). */
export function translateWorld(file: PigmaFile, ids: Iterable<string>, dx: number, dy: number): PigmaFile {
  if (dx === 0 && dy === 0) return file;
  let document = file.document;
  for (const id of ids) {
    const node = findNode(document, id);
    if (!node || node.type === 'DOCUMENT' || node.type === 'CANVAS') continue;
    if (node.locked) continue;
    // An auto-layout parent owns its children's positions: free movement would be
    // overwritten by the next reflow, so the layout reorders them instead.
    const parentNode = findParent(document, id);
    if (parentNode && autoLayoutOf(parentNode)) continue;
    const parent = parentWorldTransform(document, id);
    const local = deltaInSpace(parent, dx, dy);
    document = updateNode(document, id, (n) => ({
      ...n,
      transform: { ...n.transform, tx: n.transform.tx + local.x, ty: n.transform.ty + local.y },
    }));
  }
  return touch({ ...file, document });
}

/**
 * Position a node so its axis-aligned world box starts at (x, y).
 *
 * The box is what the properties panel shows and what drags carry around, and it
 * differs from the node's origin for rotated nodes — moving the origin directly
 * would make those jump. Translating by the box delta keeps both correct.
 */
export function setWorldPosition(file: PigmaFile, id: string, x: number, y: number): PigmaFile {
  const node = findNode(file.document, id);
  if (!node || node.type === 'DOCUMENT' || node.type === 'CANVAS' || node.locked) return file;
  const bounds = absoluteBounds(file.document, id);
  if (!bounds) return file;
  const dx = x - bounds.x;
  const dy = y - bounds.y;
  if (dx === 0 && dy === 0) return file;
  return translateWorld(file, [id], dx, dy);
}

/** Set a node's rotation, expressed in world degrees. */
export function setWorldRotation(file: PigmaFile, id: string, degrees: number): PigmaFile {
  const node = findNode(file.document, id);
  if (!node || node.locked) return file;
  const parentRotation = rotationOf(parentWorldTransform(file.document, id));
  return touch({
    ...file,
    document: updateNode(file.document, id, (n) => ({
      ...n,
      transform: withRotation(n.transform, degrees - parentRotation),
    })),
  });
}

/** Resize a node without moving its top-left corner (used by the properties panel). */
export function setNodeSize(file: PigmaFile, id: string, width: number, height: number): PigmaFile {
  const node = findNode(file.document, id);
  if (!node || node.type === 'DOCUMENT' || node.type === 'CANVAS' || node.locked) return file;
  const w = Math.max(1, width);
  const h = Math.max(node.type === 'LINE' ? 0 : 1, height);
  return touch({
    ...file,
    document: updateNode(file.document, id, (n) => resizeNodeTo(n, w, h)),
  });
}

/**
 * Setting a size explicitly pins that axis of an auto-layout frame (Figma turns
 * a hug into a fixed size when you type a width or drag a handle), which is also
 * what lets a WRAP layout pack against the new size.
 */
function pinLayoutAxes<T extends AnyNode>(node: T, widthChanged: boolean, heightChanged: boolean): T {
  if (!hasChildren(node)) return node;
  const layout = (node as unknown as { autoLayout?: AutoLayout }).autoLayout;
  if (!layout || layout.layoutMode === 'NONE') return node;
  if (!widthChanged && !heightChanged) return node;
  const horizontal = layout.layoutMode === 'HORIZONTAL';
  const next: AutoLayout = { ...layout };
  if (widthChanged) {
    if (horizontal) next.primaryAxisSizingMode = 'FIXED';
    else next.counterAxisSizingMode = 'FIXED';
  }
  if (heightChanged) {
    if (horizontal) next.counterAxisSizingMode = 'FIXED';
    else next.primaryAxisSizingMode = 'FIXED';
  }
  return { ...node, autoLayout: next };
}

function resizeNodeTo(node: AnyNode, width: number, height: number): AnyNode {
  if (node.type === 'DOCUMENT' || node.type === 'CANVAS') return node;
  ({ width, height } = clampSize(node, width, height));
  const pinned = pinLayoutAxes(node, width !== node.width, height !== node.height);
  node = pinned;
  if (!hasChildren(node)) {
    const next = { ...node, width, height };
    if (next.type === 'TEXT' && next.style.textAutoResize === 'WIDTH_AND_HEIGHT') {
      return { ...next, style: { ...next.style, textAutoResize: 'NONE' } };
    }
    return next;
  }
  const old = { width: node.width, height: node.height };
  const next = { width, height };

  // Groups, sections and boolean ops scale their contents as one unit; frames,
  // components and instances let each child follow its own constraints (Figma).
  if (node.type === 'GROUP' || node.type === 'SECTION' || node.type === 'BOOLEAN_OPERATION') {
    const sx = old.width > 0 ? width / old.width : 1;
    const sy = old.height > 0 ? height / old.height : 1;
    return scaleSubtree({ ...node, width, height }, sx, sy, old.width > 0 && old.height > 0);
  }

  let changed = false;
  const children = (node.children as SceneNode[]).map((child) => {
    const box = { x: child.transform.tx, y: child.transform.ty, width: child.width, height: child.height };
    const resolved = applyConstraints(box, child.constraints, old, next, limitsOf(child));
    if (
      resolved.x === box.x &&
      resolved.y === box.y &&
      resolved.width === box.width &&
      resolved.height === box.height
    ) {
      return child;
    }
    changed = true;
    return {
      ...child,
      width: resolved.width,
      height: resolved.height,
      transform: { ...child.transform, tx: resolved.x, ty: resolved.y },
    };
  });
  if (!changed) return { ...node, width, height };
  return { ...node, width, height, children } as AnyNode;
}

/** Scale a node's descendants in place (Figma scales group/frame contents). */
function scaleSubtree<T extends SceneNode>(node: T, sx: number, sy: number, apply: boolean): T {
  if (!apply || !hasChildren(node)) return node;
  const children = node.children.map((child) => {
    const scaled: SceneNode = {
      ...child,
      width: Math.max(0, child.width * sx),
      height: Math.max(0, child.height * sy),
      transform: {
        a: child.transform.a * sx,
        b: child.transform.b * sx,
        c: child.transform.c * sy,
        d: child.transform.d * sy,
        tx: child.transform.tx * sx,
        ty: child.transform.ty * sy,
      },
    };
    return scaleSubtree(scaled, sx, sy, true);
  });
  return { ...node, children };
}

export interface ResizeOptions {
  fromCenter?: boolean;
  keepRatio?: boolean;
  /** Snap the resulting size to whole pixels (Figma rounds while dragging with snap on). */
  snap?: number;
}

/**
 * Drag-resize: `dx`/`dy` are world-space pointer deltas, `handle` names the
 * grabbed corner/edge. The opposite edge/corner stays anchored.
 */
export function resizeFromHandle(
  file: PigmaFile,
  id: string,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  options: ResizeOptions = {},
): PigmaFile {
  const node = findNode(file.document, id);
  if (!node || node.type === 'DOCUMENT' || node.type === 'CANVAS' || node.locked) return file;
  const parent = parentWorldTransform(file.document, id);
  const local = deltaInSpace(parent, dx, dy);
  const rotation = (rotationOf(node.transform) * Math.PI) / 180;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  // Pointer delta expressed in the node's own (unrotated) axes.
  const dlx = cos * local.x + sin * local.y;
  const dly = -sin * local.x + cos * local.y;

  const left = handle === 'nw' || handle === 'w' || handle === 'sw';
  const right = handle === 'ne' || handle === 'e' || handle === 'se';
  const top = handle === 'nw' || handle === 'n' || handle === 'ne';
  const bottom = handle === 'sw' || handle === 's' || handle === 'se';
  const factor = options.fromCenter ? 2 : 1;

  let width = node.width;
  let height = node.height;
  let shiftX = 0;
  let shiftY = 0;

  if (right) width += dlx * factor;
  if (left) {
    width -= dlx * factor;
    shiftX = dlx;
  }
  if (bottom) height += dly * factor;
  if (top) {
    height -= dly * factor;
    shiftY = dly;
  }

  if (options.keepRatio && node.width > 0 && node.height > 0) {
    const ratio = node.height / node.width;
    const byWidth = Math.abs(width / node.width - 1) >= Math.abs(height / node.height - 1);
    if (byWidth) height = width * ratio;
    else width = height / ratio;
    if (left) shiftX = node.width - width;
    if (top) shiftY = node.height - height;
  }

  // Declared limits win over the implicit 1-unit minimum, and the anchored edge
  // stays put when a clamp pulls the box back.
  const limits = limitsOf(node);
  const clampedWidth = clampWidth(limits, width);
  if (clampedWidth !== width) {
    if (left) shiftX -= clampedWidth - width;
    width = clampedWidth;
  }
  const clampedHeight = clampHeight(limits, height);
  if (clampedHeight !== height) {
    if (top) shiftY -= clampedHeight - height;
    height = clampedHeight;
  }

  const snap = options.snap ?? 0;
  if (snap > 0) {
    width = clampWidth(limits, Math.round(width / snap) * snap);
    height = clampHeight(limits, Math.round(height / snap) * snap);
  }

  // Convert the local-axis shift back into a parent-space translation delta.
  const shiftParent = {
    x: cos * shiftX - sin * shiftY,
    y: sin * shiftX + cos * shiftY,
  };

  const scaled = scaleSubtree(
    node,
    node.width > 0 ? width / node.width : 1,
    node.height > 0 ? height / node.height : 1,
    hasChildren(node),
  );
  // Dragging a handle pins the axes it changed, so a hug stops fighting the drag.
  const pinned = pinLayoutAxes(scaled as SceneNode, width !== node.width, height !== node.height);
  const next: SceneNode = {
    ...(pinned as SceneNode),
    width,
    height,
    transform: {
      ...node.transform,
      tx: node.transform.tx + shiftParent.x,
      ty: node.transform.ty + shiftParent.y,
    },
  };

  return touch({ ...file, document: updateNode(file.document, id, () => next) });
}

/** Clone a subtree, giving every node a fresh id. Returns the id remap. */
export function cloneSubtree(node: SceneNode, idMap: Map<string, string> = new Map()): { node: SceneNode; idMap: Map<string, string> } {
  const id = nextNodeId();
  idMap.set(node.id, id);
  const copy: SceneNode = { ...node, id } as SceneNode;
  if (hasChildren(node)) {
    const children = node.children.map((child) => cloneSubtree(child, idMap).node);
    (copy as ContainerNode).children = children;
  }
  return { node: copy, idMap };
}

/** Rewrite interaction destinations through an id remap (used after duplicate/paste). */
function remapInteractions(node: SceneNode, idMap: Map<string, string>): SceneNode {
  const next = { ...node } as SceneNode;
  if (node.interactions?.length) {
    next.interactions = node.interactions.map((interaction) => ({
      ...interaction,
      actions: interaction.actions.map((action) =>
        action.destinationId && idMap.has(action.destinationId)
          ? { ...action, destinationId: idMap.get(action.destinationId) ?? null }
          : action,
      ),
    }));
  }
  if (hasChildren(node)) {
    (next as ContainerNode).children = node.children.map((child) => remapInteractions(child, idMap));
  }
  return next;
}

export function duplicateNodes(file: PigmaFile, ids: string[]): { file: PigmaFile; newIds: string[] } {
  const idMap = new Map<string, string>();
  const copies: Array<{ parentId: string; index: number; node: SceneNode }> = [];
  for (const id of ids) {
    const node = findNode(file.document, id);
    if (!node || node.type === 'DOCUMENT' || node.type === 'CANVAS') continue;
    const info = parentAndIndex(file.document, id);
    if (!info) continue;
    copies.push({ parentId: info.parent.id, index: info.index + 1, node: cloneSubtree(node as SceneNode, idMap).node });
  }
  let document: Node = file.document;
  // Insert from the end so indices stay valid for later siblings.
  for (const copy of [...copies].reverse()) {
    document = insertChild(document, copy.parentId, remapInteractions(copy.node, idMap), copy.index);
  }
  return {
    file: touch({ ...file, document: document as PigmaFile['document'] }),
    newIds: [...idMap.values()],
  };
}

/**
 * Group the given nodes. Children are rebased into the group so the group's box
 * is its real bounds (functionally identical to Figma, simpler to render).
 */
export function groupNodes(file: PigmaFile, ids: string[]): { file: PigmaFile; groupId: string | null } {
  const first = ids[0];
  if (!first) return { file, groupId: null };
  const firstParent = findParent(file.document, first);
  if (!firstParent) return { file, groupId: null };

  let document: Node = file.document;
  const members: string[] = [];
  for (const id of ids) {
    const parent = findParent(document, id);
    if (!parent) continue;
    if (parent.id !== firstParent.id) {
      document = moveNode(document, id, firstParent.id);
    }
    members.push(id);
  }
  if (members.length < 2) return { file, groupId: null };

  const parentSpace = worldTransform(document, firstParent.id);
  // Bounds expressed in the group's parent space.
  const localBounds = boundsInSpace(document, members, parentSpace);
  const groupId = nextNodeId();
  const order = members
    .map((id) => parentAndIndex(document, id)?.index ?? 0)
    .sort((a, b) => a - b);
  const insertIndex = order.length > 0 ? (order[order.length - 1] ?? 0) + 1 - members.length : 0;

  const group: ContainerNode = {
    id: groupId,
    name: 'Group',
    type: 'GROUP',
    visible: true,
    locked: false,
    opacity: 1,
    transform: { ...localBoundsTransform(localBounds) },
    width: localBounds.width,
    height: localBounds.height,
    fills: [],
    strokes: [],
    children: [],
    clipsContent: false,
  };

  const removed = removeNodes(document, members);
  document = removed.root;
  const rebased = removed.removed.map((node) => ({
    ...node,
    transform: { ...node.transform, tx: node.transform.tx - localBounds.x, ty: node.transform.ty - localBounds.y },
  }));
  document = insertChild(document, firstParent.id, { ...group, children: rebased }, Math.max(0, insertIndex));
  return { file: touch({ ...file, document: document as PigmaFile['document'] }), groupId };
}

function localBoundsTransform(bounds: Rect): Transform {
  return { a: 1, b: 0, c: 0, d: 1, tx: bounds.x, ty: bounds.y };
}

/** Bounds of nodes measured in an arbitrary ancestor space. */
function boundsInSpace(root: Node, ids: string[], space: Transform): Rect {
  const inv = invert(space);
  let acc: Rect | null = null;
  for (const id of ids) {
    const node = findNode(root, id);
    if (!node) continue;
    const local = multiply(inv, worldTransform(root, id));
    const b = boundsOf(local, node.width, node.height);
    acc = acc
      ? {
          x: Math.min(acc.x, b.x),
          y: Math.min(acc.y, b.y),
          width: Math.max(acc.x + acc.width, b.x + b.width) - Math.min(acc.x, b.x),
          height: Math.max(acc.y + acc.height, b.y + b.height) - Math.min(acc.y, b.y),
        }
      : b;
  }
  return acc ?? { x: 0, y: 0, width: 0, height: 0 };
}

/** Dissolve groups/frames, keeping children's world positions. */
export function ungroupNodes(file: PigmaFile, ids: string[]): { file: PigmaFile; newIds: string[] } {
  let document: Node = file.document;
  const newIds: string[] = [];
  for (const id of ids) {
    const node = findNode(document, id);
    if (!node || !hasChildren(node)) continue;
    const info = parentAndIndex(document, id);
    if (!info) continue;
    const parentId = info.parent.id;
    const index = info.index;
    const children = node.children.map((child) => ({
      ...child,
      transform: multiply(node.transform, child.transform),
    }));
    document = removeNode(document, id).root;
    children.forEach((child, offset) => {
      document = insertChild(document, parentId, child, index + offset);
      newIds.push(child.id);
    });
  }
  return { file: touch({ ...file, document: document as PigmaFile['document'] }), newIds };
}

export type ReorderMode = 'front' | 'forward' | 'backward' | 'back';

/** Reorder within the parent's children (Figma z-order semantics). */
export function reorderNodes(file: PigmaFile, ids: string[], mode: ReorderMode): PigmaFile {
  let document: Node = file.document;
  const ordered = ids
    .map((id) => ({ id, index: parentAndIndex(document, id)?.index ?? -1 }))
    .filter((entry) => entry.index >= 0)
    .sort((a, b) => (mode === 'front' || mode === 'forward' ? b.index - a.index : a.index - b.index));

  for (const { id } of ordered) {
    const info = parentAndIndex(document, id);
    if (!info) continue;
    const node = info.parent.children[info.index];
    if (!node) continue;
    const siblings = info.parent.children.filter((c) => c.id !== id);
    const target = info.index;
    let nextIndex = target;
    switch (mode) {
      case 'front':
        nextIndex = siblings.length;
        break;
      case 'back':
        nextIndex = 0;
        break;
      case 'forward':
        nextIndex = Math.min(siblings.length, target + 1);
        break;
      case 'backward':
        nextIndex = Math.max(0, target - 1);
        break;
    }
    if (nextIndex === target) continue;
    const children = [...siblings];
    children.splice(nextIndex, 0, node);
    document = updateNode(document, info.parent.id, (parent) => ({ ...parent, children }) as Node);
  }
  return touch({ ...file, document: document as PigmaFile['document'] });
}

/** Align nodes. With a single node, aligns inside its parent container (Figma behaviour). */
export function alignNodes(file: PigmaFile, ids: string[], mode: AlignMode): PigmaFile {
  if (ids.length === 0) return file;
  let reference: Rect | null = null;
  if (ids.length === 1) {
    const id = ids[0];
    if (!id) return file;
    const parent = findParent(file.document, id);
    if (parent && parent.type !== 'CANVAS' && parent.type !== 'DOCUMENT') {
      reference = boundsOf(worldTransform(file.document, parent.id), parent.width, parent.height);
    }
  }
  const selection = boundsOfNodes(file.document, ids);
  const box = reference ?? selection;
  if (!box) return file;

  let next = file;
  for (const id of ids) {
    const b = absoluteBounds(next.document, id);
    if (!b) continue;
    let dx = 0;
    let dy = 0;
    switch (mode) {
      case 'left':
        dx = box.x - b.x;
        break;
      case 'hcenter':
        dx = box.x + box.width / 2 - (b.x + b.width / 2);
        break;
      case 'right':
        dx = box.x + box.width - (b.x + b.width);
        break;
      case 'top':
        dy = box.y - b.y;
        break;
      case 'vcenter':
        dy = box.y + box.height / 2 - (b.y + b.height / 2);
        break;
      case 'bottom':
        dy = box.y + box.height - (b.y + b.height);
        break;
    }
    next = translateWorld(next, [id], dx, dy);
  }
  return next;
}

/** Even spacing between nodes along one axis (Figma "distribute"). */
export function distributeNodes(file: PigmaFile, ids: string[], axis: 'horizontal' | 'vertical'): PigmaFile {
  if (ids.length < 3) return file;
  const entries = ids
    .map((id) => ({ id, bounds: absoluteBounds(file.document, id) }))
    .filter((entry): entry is { id: string; bounds: Rect } => !!entry.bounds);
  if (entries.length < 3) return file;
  const key = axis === 'horizontal' ? 'x' : 'y';
  const size = axis === 'horizontal' ? 'width' : 'height';
  entries.sort((a, b) => a.bounds[key] - b.bounds[key]);

  const first = entries[0];
  const last = entries[entries.length - 1];
  if (!first || !last) return file;
  const span = last.bounds[key] + last.bounds[size] - first.bounds[key];
  const totalSize = entries.reduce((sum, entry) => sum + entry.bounds[size], 0);
  const gap = (span - totalSize) / (entries.length - 1);

  let cursor = first.bounds[key];
  let next = file;
  for (const entry of entries) {
    const delta = cursor - entry.bounds[key];
    next = translateWorld(next, [entry.id], axis === 'horizontal' ? delta : 0, axis === 'horizontal' ? 0 : delta);
    cursor += entry.bounds[size] + gap;
  }
  return next;
}

/** Convert a clipboard payload into nodes ready to insert, with fresh ids. */
export function instantiateClipboard(
  file: PigmaFile,
  payload: SceneNode[],
  parentId: string,
): { file: PigmaFile; newIds: string[] } {
  const idMap = new Map<string, string>();
  const clones = payload.map((node) => cloneSubtree(node, idMap).node);
  let document: Node = file.document;
  for (const node of clones) {
    document = insertChild(document, parentId, remapInteractions(node, idMap));
  }
  return { file: touch({ ...file, document: document as PigmaFile['document'] }), newIds: [...idMap.values()] };
}

/** Wrap a node in a frame sized to the node (Figma "frame selection"). */
export function frameSelection(file: PigmaFile, ids: string[]): { file: PigmaFile; frameId: string | null } {
  const first = ids[0];
  if (!first) return { file, frameId: null };
  const parent = findParent(file.document, first);
  if (!parent) return { file, frameId: null };
  const parentSpace = worldTransform(file.document, parent.id);
  const bounds = boundsInSpace(file.document, ids, parentSpace);
  const frameId = nextNodeId();
  const removed = removeNodes(file.document, ids);
  const frame: ContainerNode = {
    id: frameId,
    name: 'Frame',
    type: 'FRAME',
    visible: true,
    locked: false,
    opacity: 1,
    transform: localBoundsTransform(bounds),
    width: bounds.width,
    height: bounds.height,
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 1 }],
    strokes: [],
    children: removed.removed.map((node) => ({
      ...node,
      transform: { ...node.transform, tx: node.transform.tx - bounds.x, ty: node.transform.ty - bounds.y },
    })),
    clipsContent: true,
    autoLayout: { layoutMode: 'NONE' },
  };
  const document = insertChild(removed.root, parent.id, frame);
  return { file: touch({ ...file, document: document as PigmaFile['document'] }), frameId };
}

/**
 * A node paints only when it and every ancestor below the document are visible.
 *
 * Iterative on purpose: the validator only *warns* about duplicate ids, so a
 * parent-chain recursion can revisit the same id forever. `findPath` walks the
 * finite child structure instead, so it always terminates.
 */
export function isEffectivelyVisible(root: Node, id: string): boolean {
  const path = findPath(root, id);
  if (!path) return false;
  for (const node of path) {
    if (node.type === 'DOCUMENT') continue;
    if (!node.visible) return false;
  }
  return true;
}

const LOCK_EXEMPT_KEYS: ReadonlySet<string> = new Set(['name', 'visible', 'locked']);

/** Flat property patch used by the properties panel and keyboard nudges. */
export interface NodePatch {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  name?: string;
  visible?: boolean;
  locked?: boolean;
  opacity?: number;
  blendMode?: BaseNode['blendMode'];
  fills?: Paint[];
  strokes?: Paint[];
  strokeWeight?: number;
  strokeAlign?: StrokeAlign;
  /** Dash pattern in stroke-weight units (Figma's `dashPattern`); [] clears it. */
  dashPattern?: number[];
  cornerRadius?: number;
  /**
   * Sides of a polygon / points of a star (Figma's `pointCount`). Ignored for
   * every other node type — see `applyNodePatch`.
   */
  pointCount?: number;
  /** How deep a star's inner points reach, 0..1 of the outer radius. Ignored off a star. */
  innerRadius?: number;
  /** Per-corner radii; set to undefined to fall back to `cornerRadius`. */
  rectangleCornerRadii?: [number, number, number, number];
  /** Size limits (M10); `undefined` clears a limit. */
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  clipsContent?: boolean;
  characters?: string;
  constraints?: Constraints;
  effects?: Effect[];
  layoutGrids?: LayoutGrid[];
  overflowDirection?: OverflowDirection;
  booleanOperation?: ChildrenMixin['booleanOperation'];
}

/**
 * Apply a property patch to one node. Geometry keys are routed through the
 * transform-aware setters (x/y are world coordinates), the rest merge directly.
 */
export function applyNodePatch(file: PigmaFile, id: string, patch: NodePatch): PigmaFile {
  const start = findNode(file.document, id);
  if (!start || start.type === 'DOCUMENT' || start.type === 'CANVAS') return file;
  // Locked layers reject content edits (fills, size, position, effects) but keep
  // their panel metadata editable: renaming, hiding and unlocking still work.
  if (start.locked && Object.keys(patch).some((key) => !LOCK_EXEMPT_KEYS.has(key))) return file;
  let next = file;

  const { x, y, width, height, rotation, ...rest } = patch;
  // `pointCount` and `innerRadius` only mean anything on a polygon or a star.
  // The node union shares one shape variant, so a rectangle is structurally
  // allowed to carry them — drop them here rather than trusting every caller to
  // be polite, and the model keeps its own invariant.
  if (start.type !== 'POLYGON' && start.type !== 'STAR') {
    delete rest.pointCount;
    delete rest.innerRadius;
  }
  const restKeys = Object.keys(rest) as Array<keyof typeof rest>;
  if (restKeys.length > 0) {
    const node = findNode(next.document, id);
    if (node && node.type !== 'DOCUMENT' && node.type !== 'CANVAS') {
      // The patch keys are shared by several node variants; merge then re-narrow.
      const merged = Object.assign({}, node, rest) as SceneNode;
      const changed = restKeys.some((key) => node[key as keyof SceneNode] !== rest[key]);
      if (changed) next = { ...next, document: updateNode(next.document, id, () => merged) };
    }
  }

  const current = findNode(next.document, id);
  if (!current || current.type === 'DOCUMENT' || current.type === 'CANVAS') return next;
  const bounds = absoluteBounds(next.document, id);
  if ((x !== undefined && bounds && x !== bounds.x) || (y !== undefined && bounds && y !== bounds.y)) {
    next = setWorldPosition(next, id, x ?? bounds?.x ?? 0, y ?? bounds?.y ?? 0);
  }
  if ((width !== undefined && width !== current.width) || (height !== undefined && height !== current.height)) {
    next = setNodeSize(next, id, width ?? current.width, height ?? current.height);
  }
  if (rotation !== undefined && Math.abs(rotationOf(current.transform) - rotation) > 1e-6) {
    next = setWorldRotation(next, id, rotation);
  }
  return next;
}

export function applyNodePatchToAll(file: PigmaFile, ids: Iterable<string>, patch: NodePatch): PigmaFile {
  let next = file;
  for (const id of ids) next = applyNodePatch(next, id, patch);
  return next;
}

/**
 * Scale several nodes proportionally about an anchor point (multi-select
 * resize). Each node's absolute box is scaled, then written back in world
 * coordinates, so rotated parents stay correct.
 */
export function scaleSelection(
  file: PigmaFile,
  ids: Iterable<string>,
  anchor: { x: number; y: number },
  scaleX: number,
  scaleY: number,
): PigmaFile {
  let next = file;
  for (const id of ids) {
    const node = findNode(next.document, id);
    if (!node || node.type === 'DOCUMENT' || node.type === 'CANVAS' || node.locked) continue;
    const bounds = absoluteBounds(next.document, id);
    if (!bounds) continue;
    const width = Math.max(node.type === 'LINE' ? 1 : 1, bounds.width * scaleX);
    const height = Math.max(node.type === 'LINE' ? 0 : 1, bounds.height * scaleY);
    const x = anchor.x + (bounds.x - anchor.x) * scaleX;
    const y = anchor.y + (bounds.y - anchor.y) * scaleY;
    next = setNodeSize(next, id, width, height);
    next = setWorldPosition(next, id, x, y);
  }
  return next;
}

/** Move several nodes to explicit world positions (used by snapped drags). */
export function positionNodes(file: PigmaFile, entries: Array<{ id: string; x: number; y: number }>): PigmaFile {
  let next = file;
  for (const entry of entries) next = setWorldPosition(next, entry.id, entry.x, entry.y);
  return next;
}

/**
 * Reorder a child of an auto-layout parent by dragging: the drag distance is
 * converted into a slot shift along the primary axis (Figma's behaviour).
 */
export function reorderByDrag(file: PigmaFile, id: string, dx: number, dy: number): PigmaFile {
  const info = parentAndIndex(file.document, id);
  if (!info) return file;
  const layout = autoLayoutOf(info.parent);
  if (!layout) return file;
  const node = findNode(file.document, id);
  if (!node) return file;

  const horizontal = layout.layoutMode === 'HORIZONTAL';
  const delta = horizontal ? dx : dy;
  const extent = (horizontal ? node.width : node.height) + (layout.itemSpacing ?? 0);
  if (extent <= 0) return file;
  const shift = Math.round(delta / extent);
  if (shift === 0) return file;

  const children = (info.parent.children as SceneNode[]).filter((child) => child.id !== id);
  const target = Math.max(0, Math.min(children.length, info.index + shift));
  children.splice(target, 0, node as SceneNode);
  return touch({
    ...file,
    document: updateNode(file.document, info.parent.id, (parent) => ({ ...parent, children }) as AnyNode),
  });
}

/** Apply an auto-layout setting to the selected containers. */
export function setAutoLayout(file: PigmaFile, ids: Iterable<string>, patch: Partial<AutoLayout>): PigmaFile {
  let next = file;
  for (const id of ids) {
    const node = findNode(next.document, id);
    if (!node || !hasChildren(node) || node.locked) continue;
    next = touch({
      ...next,
      document: updateNode(next.document, id, (target) => {
        if (!hasChildren(target)) return target;
        const current = (target as { autoLayout?: AutoLayout }).autoLayout ?? { layoutMode: 'NONE' as const };
        return { ...target, autoLayout: { ...current, ...patch } } as AnyNode;
      }),
    });
  }
  return next;
}
