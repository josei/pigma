import type { AnyNode, PigmaFile, SceneNode, Transform } from './types';
import { findNode, updateNode } from './tree';
import { multiply } from './matrix';

/**
 * Flip (mirror) a node about its own centre, Figma's Shift+H / Shift+V.
 *
 * The mirror is applied in the node's *local* space (so it survives rotation).
 * Descendants need no changes: their coordinates live in the mirrored space, so
 * a frame's contents flip with it — exactly like Figma.
 */

export type FlipAxis = 'horizontal' | 'vertical';

/** Local-space mirror about the box centre: x' = w - x, or y' = h - y. */
export function mirrorTransform(width: number, height: number, axis: FlipAxis): Transform {
  return axis === 'horizontal'
    ? { a: -1, b: 0, c: 0, d: 1, tx: width, ty: 0 }
    : { a: 1, b: 0, c: 0, d: -1, tx: 0, ty: height };
}

/** Flip one node (its contents follow, because they live in its space). */
export function flipNode<T extends AnyNode>(root: T, id: string, axis: FlipAxis): T {
  const node = findNode(root, id);
  if (!node || node.type === 'DOCUMENT' || node.type === 'CANVAS' || node.locked) return root;
  const mirror = mirrorTransform(node.width, node.height, axis);
  const flipped = { ...node, transform: multiply(node.transform, mirror) } as SceneNode;
  return updateNode(root, id, () => flipped) as T;
}

/** Flip every listed node. */
export function flipNodes(file: PigmaFile, ids: Iterable<string>, axis: FlipAxis): PigmaFile {
  let document = file.document;
  let changed = false;
  for (const id of ids) {
    const node = findNode(document, id);
    if (!node || node.type === 'DOCUMENT' || node.type === 'CANVAS' || node.locked) continue;
    document = flipNode(document, id, axis);
    changed = true;
  }
  return changed ? { ...file, document } : file;
}
