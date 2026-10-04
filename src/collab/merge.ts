import type { AnyNode, PigmaFile, SceneNode } from '../model/types';
import { hasChildren } from '../model/types';
import { findNode, insertChild, removeNode, updateNode, walk } from '../model/tree';

/**
 * Concurrent-edit convergence (M13).
 *
 * The relay stamps every batch of edits with a monotonic `seq` and relays them
 * verbatim; this module decides what those remote edits mean locally. The rules
 * are deliberately small and total, so any two clients holding the same set of
 * stamped batches converge on the same document no matter what order the batches
 * arrive in:
 *
 * - Edits are **node-scoped** (`patch` / `add` / `remove`), never document-wide.
 * - Every node carries the stamp of the batch that last wrote **each field**:
 *   `{ seq, clientId }`. A write wins when its stamp is greater, compared as
 *   `(seq, clientId)` — the clientId tiebreak makes two edits with the same seq
 *   (the case a relay cannot order for us) resolve identically everywhere.
 * - Nodes no batch mentions are never touched, so local work on them survives.
 * - `remove` beats any patch to the same node, at the stamp of the removal.
 *
 * Consequences worth stating plainly: this is last-writer-wins per field, not a
 * text/vector CRDT. Two people editing the *same* field of the same node keep
 * one of the two values (deterministically); the other is dropped, not merged.
 */

export interface NodePatchOp {
  kind: 'patch';
  nodeId: string;
  /** Changed fields only; the same shape `applyNodePatch` accepts. */
  fields: Record<string, unknown>;
}

export interface NodeAddOp {
  kind: 'add';
  parentId: string;
  index?: number;
  node: SceneNode;
}

export interface NodeRemoveOp {
  kind: 'remove';
  nodeId: string;
}

export type EditOp = NodePatchOp | NodeAddOp | NodeRemoveOp;

/** A batch of ops as the relay stamps it. */
export interface StampedOps {
  seq: number;
  clientId: string;
  ops: EditOp[];
}

/** Per-field winner, and the stamp of a node's removal. */
export interface ConvergenceState {
  /** `nodeId -> field -> stamp` for patch wins. */
  fields: Record<string, Record<string, Stamp>>;
  /** `nodeId -> stamp` for the removal that won, when one did. */
  removed: Record<string, Stamp>;
}

export interface Stamp {
  seq: number;
  clientId: string;
}

export const EMPTY_CONVERGENCE: ConvergenceState = { fields: {}, removed: {} };

/** Total order over stamps: sequence first, then the client id as a tiebreak. */
export function compareStamps(a: Stamp, b: Stamp): number {
  if (a.seq !== b.seq) return a.seq - b.seq;
  return a.clientId < b.clientId ? -1 : a.clientId > b.clientId ? 1 : 0;
}

/** True when `candidate` should overwrite `current` (absent = always). */
export function wins(candidate: Stamp, current: Stamp | undefined): boolean {
  return current === undefined || compareStamps(candidate, current) > 0;
}

/** Fields of a node that can appear in a patch (everything but identity/children). */
const PATCHABLE_SKIP = new Set(['id', 'type', 'children', 'raw']);

function comparable(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Changed fields between two versions of the same node. */
export function changedFields(before: SceneNode, after: SceneNode): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    if (PATCHABLE_SKIP.has(key)) continue;
    const next = (after as unknown as Record<string, unknown>)[key];
    const previous = (before as unknown as Record<string, unknown>)[key];
    if (comparable(next) !== comparable(previous)) fields[key] = next;
  }
  // A field that disappeared counts as a change to `undefined`.
  for (const key of Object.keys(before)) {
    if (PATCHABLE_SKIP.has(key)) continue;
    if (!(key in (after as unknown as Record<string, unknown>))) fields[key] = undefined;
  }
  return fields;
}

function indexNodes(root: AnyNode, out = new Map<string, SceneNode>()): Map<string, SceneNode> {
  walk(root, (node) => {
    if (node.type !== 'DOCUMENT' && node.type !== 'CANVAS') out.set(node.id, node as SceneNode);
  });
  return out;
}

function parentIdOf(root: AnyNode, id: string): string | null {
  const walk = (node: AnyNode, parent: string | null): string | null => {
    if (node.id === id) return parent;
    if (!hasChildren(node)) return null;
    for (const child of node.children) {
      const found = walk(child, parent === null && node.type === 'CANVAS' ? node.id : node.id);
      if (found !== null) return found;
    }
    return null;
  };
  return walk(root, null);
}

/**
 * Ops that turn `before` into `after`: adds, removals and per-field patches.
 * Identity (id/type/children) is never patched — structure travels as add/remove.
 */
export function diffFiles(before: PigmaFile, after: PigmaFile): EditOp[] {
  const previous = indexNodes(before.document);
  const next = indexNodes(after.document);
  const ops: EditOp[] = [];

  for (const [id, node] of next) {
    if (!previous.has(id)) {
      const parentId = parentIdOf(after.document, id) ?? '';
      if (parentId !== '') ops.push({ kind: 'add', parentId, node });
      continue;
    }
    const fields = changedFields(previous.get(id)!, node);
    if (Object.keys(fields).length > 0) ops.push({ kind: 'patch', nodeId: id, fields });
  }
  for (const id of previous.keys()) {
    if (!next.has(id)) ops.push({ kind: 'remove', nodeId: id });
  }
  return ops;
}

/**
 * Apply one stamped batch. Returns the same file when nothing won, so the caller
 * can skip a re-render.
 */
export function applyRemoteOps(
  file: PigmaFile,
  batch: StampedOps,
  state: ConvergenceState = EMPTY_CONVERGENCE,
): { file: PigmaFile; state: ConvergenceState } {
  const stamp: Stamp = { seq: batch.seq, clientId: batch.clientId };
  let document = file.document;
  const fields: Record<string, Record<string, Stamp>> = { ...state.fields };
  const removed: Record<string, Stamp> = { ...state.removed };
  let changed = false;

  for (const op of batch.ops) {
    if (op.kind === 'add') {
      if (findNode(document, op.node.id)) continue;
      if (removed[op.node.id] && wins(removed[op.node.id]!, stamp)) continue;
      const parent = findNode(document, op.parentId);
      if (!parent || !hasChildren(parent)) continue;
      document = insertChild(document, op.parentId, op.node, op.index);
      delete removed[op.node.id];
      changed = true;
      continue;
    }

    if (op.kind === 'remove') {
      if (!findNode(document, op.nodeId)) continue;
      if (!wins(stamp, removed[op.nodeId])) continue;
      removed[op.nodeId] = stamp;
      document = removeNode(document, op.nodeId).root;
      delete fields[op.nodeId];
      changed = true;
      continue;
    }

    // patch: per-field last-writer-wins.
    const node = findNode(document, op.nodeId);
    if (!node) continue;
    const winners = { ...(fields[op.nodeId] ?? {}) };
    const accepted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(op.fields)) {
      if (!wins(stamp, winners[key])) continue;
      winners[key] = stamp;
      accepted[key] = value;
    }
    if (Object.keys(accepted).length === 0) continue;
    fields[op.nodeId] = winners;
    document = updateNode(document, op.nodeId, (target) => ({ ...target, ...accepted }) as AnyNode);
    changed = true;
  }

  return { file: changed ? { ...file, document } : file, state: { fields, removed } };
}

/**
 * Record a *local* edit with the stamp it happened at, so later remote batches
 * and snapshots can be compared against it.
 *
 * A client stamps its own writes with the last sequence it has seen plus its own
 * increasing counter: local edits therefore order among themselves, and a remote
 * batch or snapshot that is genuinely newer still wins. Without this, a snapshot
 * could not tell a fresh local edit from an untouched node.
 */
export function applyLocalOps(
  before: PigmaFile,
  after: PigmaFile,
  stamp: Stamp,
  state: ConvergenceState = EMPTY_CONVERGENCE,
): ConvergenceState {
  const ops = diffFiles(before, after);
  if (ops.length === 0) return state;
  const fields: Record<string, Record<string, Stamp>> = { ...state.fields };
  const removed = { ...state.removed };
  for (const op of ops) {
    if (op.kind === 'patch') {
      const winners = { ...(fields[op.nodeId] ?? {}) };
      for (const key of Object.keys(op.fields)) {
        if (wins(stamp, winners[key])) winners[key] = stamp;
      }
      fields[op.nodeId] = winners;
      continue;
    }
    if (op.kind === 'remove') {
      if (wins(stamp, removed[op.nodeId])) removed[op.nodeId] = stamp;
      delete fields[op.nodeId];
      continue;
    }
    // An added node is owned by the writer from its stamp onwards.
    delete removed[op.node.id];
    fields[op.node.id] = { '*': stamp };
  }
  return { fields, removed };
}

/** Stamp for a local edit: the last seen sequence plus the client's own counter. */
export function localStamp(options: { lastSeenSeq: number; localCounter: number; clientId: string }): Stamp {
  return { seq: options.lastSeenSeq + options.localCounter, clientId: options.clientId };
}

/** Apply many batches; order does not matter for the result. */
export function applyRemoteBatches(
  file: PigmaFile,
  batches: StampedOps[],
  state: ConvergenceState = EMPTY_CONVERGENCE,
): { file: PigmaFile; state: ConvergenceState } {
  let current = file;
  let convergence = state;
  for (const batch of batches) {
    const applied = applyRemoteOps(current, batch, convergence);
    current = applied.file;
    convergence = applied.state;
  }
  return { file: current, state: convergence };
}

/**
 * Merge a room snapshot (the document some peer had at `seq`) into ours: every
 * node the snapshot knows about is a patch at that stamp, so a snapshot can
 * never silently discard newer local edits.
 */
export function mergeSnapshot(
  file: PigmaFile,
  snapshot: { file: unknown; seq: number; clientId?: string },
  state: ConvergenceState = EMPTY_CONVERGENCE,
): { file: PigmaFile; state: ConvergenceState } {
  const incoming = snapshot.file as PigmaFile | null;
  if (!incoming || typeof incoming !== 'object' || !incoming.document) return { file, state };
  const batch: StampedOps = {
    seq: snapshot.seq,
    clientId: snapshot.clientId ?? 'snapshot',
    ops: diffFiles(file, incoming),
  };
  return applyRemoteOps(file, batch, state);
}
