import type { AnyNode, PigmaFile, SceneNode } from './types';
import { hasChildren } from './types';

/**
 * Version compare: what changed between two documents.
 *
 * Figma's version history highlights added, removed and changed layers; this is
 * the data behind that. It is **pure** and **id-keyed**: node identity is the
 * node's id (not its position in the tree), so a layer that merely moved inside
 * its parent is a change, not an add-and-remove pair. Ordering follows the
 * documents (depth-first, `to` first for the ids it has), so the same pair of
 * documents always produces the same report.
 */

/** One changed node and which of its properties differ. */
export interface NodeChange {
  id: string;
  /** The node's name in the *new* document (falling back to the old one). */
  name: string;
  /** Property names that differ, in a stable order. */
  properties: string[];
}

export interface DocumentDiff {
  /** Nodes in `to` that are not in `from`, in `to` order. */
  added: string[];
  /** Nodes in `from` that are not in `to`, in `from` order. */
  removed: string[];
  /** Nodes present in both whose content differs, in `to` order. */
  changed: NodeChange[];
  /** Total number of nodes in each document, for the summary line. */
  counts: { from: number; to: number };
}

/** The properties a comparison reports, in the order they are listed. */
export const DIFF_PROPERTIES = [
  'name',
  'type',
  'position',
  'size',
  'rotation',
  'opacity',
  'visible',
  'locked',
  'fill',
  'stroke',
  'corner radius',
  'effects',
  'text',
  'font',
  'layout',
] as const;

type DiffProperty = (typeof DIFF_PROPERTIES)[number];

/** Index every node by id, depth-first, so the order is the document's. */
function indexNodes(root: AnyNode, out: Map<string, SceneNode> = new Map()): Map<string, SceneNode> {
  if (root.type !== 'DOCUMENT' && root.type !== 'CANVAS') out.set(root.id, root as SceneNode);
  if (hasChildren(root)) for (const child of root.children) indexNodes(child, out);
  return out;
}

const round = (value: number): number => Math.round(value * 1000) / 1000;

/** Which properties of a node differ between the two versions. */
function changedProperties(before: SceneNode, after: SceneNode): DiffProperty[] {
  const changed: DiffProperty[] = [];
  const differs = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);

  if (before.name !== after.name) changed.push('name');
  if (before.type !== after.type) changed.push('type');
  if (
    differs([round(before.transform.tx), round(before.transform.ty)], [round(after.transform.tx), round(after.transform.ty)])
  ) {
    changed.push('position');
  }
  if (round(before.width) !== round(after.width) || round(before.height) !== round(after.height)) changed.push('size');
  if (differs(before.transform, after.transform)) {
    // A rotation or scale change that is not a plain translation.
    const beforeRotation = Math.atan2(before.transform.b, before.transform.a);
    const afterRotation = Math.atan2(after.transform.b, after.transform.a);
    if (Math.abs(beforeRotation - afterRotation) > 1e-6) changed.push('rotation');
  }
  if (before.opacity !== after.opacity) changed.push('opacity');
  if (before.visible !== after.visible) changed.push('visible');
  if (before.locked !== after.locked) changed.push('locked');
  if (differs(before.fills, after.fills)) changed.push('fill');
  if (differs(before.strokes, after.strokes) || before.strokeWeight !== after.strokeWeight) changed.push('stroke');
  if ((before.cornerRadius ?? 0) !== (after.cornerRadius ?? 0)) changed.push('corner radius');
  if (differs(before.effects ?? [], after.effects ?? [])) changed.push('effects');
  if (before.type === 'TEXT' && after.type === 'TEXT' && before.characters !== after.characters) changed.push('text');
  if (before.type === 'TEXT' && after.type === 'TEXT' && differs(before.style, after.style)) changed.push('font');
  const beforeLayout = (before as { autoLayout?: unknown }).autoLayout;
  const afterLayout = (after as { autoLayout?: unknown }).autoLayout;
  if (differs(beforeLayout ?? null, afterLayout ?? null)) changed.push('layout');
  return changed;
}

/** Compare two documents by node id. Pure: neither document is touched. */
export function diffDocuments(from: PigmaFile, to: PigmaFile): DocumentDiff {
  const before = indexNodes(from.document);
  const after = indexNodes(to.document);

  const added: string[] = [];
  const changed: NodeChange[] = [];
  for (const [id, node] of after) {
    const previous = before.get(id);
    if (!previous) {
      added.push(id);
      continue;
    }
    const properties = changedProperties(previous, node);
    if (properties.length > 0) changed.push({ id, name: node.name, properties });
  }
  const removed: string[] = [];
  for (const id of before.keys()) if (!after.has(id)) removed.push(id);

  return { added, removed, changed, counts: { from: before.size, to: after.size } };
}

/** True when the two documents have the same nodes and content. */
export function isUnchanged(diff: DocumentDiff): boolean {
  return diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0;
}

/** A one-line summary for the panel ("3 added · 1 removed · 2 changed"). */
export function diffSummary(diff: DocumentDiff): string {
  const parts = [
    diff.added.length > 0 ? `${diff.added.length} added` : null,
    diff.removed.length > 0 ? `${diff.removed.length} removed` : null,
    diff.changed.length > 0 ? `${diff.changed.length} changed` : null,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? 'No changes' : parts.join(' · ');
}
