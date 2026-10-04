import { describe, expect, it } from 'vitest';
import {
  EMPTY_CONVERGENCE,
  applyLocalOps,
  applyRemoteBatches,
  applyRemoteOps,
  changedFields,
  compareStamps,
  diffFiles,
  mergeSnapshot,
  type StampedOps,
} from './merge';
import { emptyFile } from '../model/validate';
import { createRectNode } from '../model/factory';
import { findNode } from '../model/tree';
import type { AnyNode, PigmaFile, SceneNode } from '../model/types';

/** Two nodes on one page, the shared starting point for both clients. */
function base(): PigmaFile {
  const file = emptyFile('Room');
  const page = file.document.children[0]!;
  const a = createRectNode(null, 0, 0, 10, 10);
  a.name = 'A';
  const b = createRectNode(null, 20, 0, 10, 10);
  b.name = 'B';
  page.children = [a, b];
  return file;
}

function rename(file: PigmaFile, id: string, name: string): PigmaFile {
  return { ...file, document: renameIn(file.document, id, name) };
}

function renameIn(document: PigmaFile['document'], id: string, name: string): PigmaFile['document'] {
  const walk = (current: AnyNode): AnyNode => {
    if (current.id === id) return { ...current, name } as AnyNode;
    if (!('children' in current) || !Array.isArray(current.children)) return current;
    return { ...current, children: (current.children as AnyNode[]).map(walk) } as AnyNode;
  };
  return { ...document, children: document.children.map((page) => walk(page)) } as PigmaFile['document'];
}

function move(file: PigmaFile, id: string, x: number): PigmaFile {
  const node = findNode(file.document, id) as SceneNode;
  const document = {
    ...file.document,
    children: file.document.children.map((page) => ({
      ...page,
      children: page.children.map((child) => (child.id === id ? { ...child, transform: { ...node.transform, tx: x } } : child)),
    })),
  } as PigmaFile['document'];
  return { ...file, document };
}

function names(file: PigmaFile): string[] {
  return (file.document.children[0]!.children as SceneNode[]).map((node) => node.name);
}

describe('concurrent-edit convergence', () => {
  it('orders stamps by sequence, then by client id', () => {
    expect(compareStamps({ seq: 1, clientId: 'a' }, { seq: 2, clientId: 'a' })).toBeLessThan(0);
    expect(compareStamps({ seq: 2, clientId: 'a' }, { seq: 2, clientId: 'b' })).toBeLessThan(0);
    expect(compareStamps({ seq: 2, clientId: 'b' }, { seq: 2, clientId: 'b' })).toBe(0);
  });

  it('diffs a document into node-scoped ops', () => {
    const before = base();
    const after = rename(before, 'A' in {} ? '' : (before.document.children[0]!.children[0]!.id), 'Renamed');
    const ops = diffFiles(before, after);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ kind: 'patch', fields: { name: 'Renamed' } });

    const added = {
      ...after,
      document: {
        ...after.document,
        children: [{ ...after.document.children[0]!, children: [...after.document.children[0]!.children, createRectNode(null, 0, 0, 1, 1)] }],
      },
    } as PigmaFile;
    expect(diffFiles(after, added).map((op) => op.kind)).toEqual(['add']);
    expect(diffFiles(added, after).map((op) => op.kind)).toEqual(['remove']);
    expect(changedFields(before.document.children[0]!.children[0]! as SceneNode, before.document.children[0]!.children[0]! as SceneNode)).toEqual({});
  });

  it('keeps concurrent edits to different nodes on both clients', () => {
    const start = base();
    const ids = (start.document.children[0]!.children as SceneNode[]).map((node) => node.id);
    const [idA, idB] = ids as [string, string];

    // Client one renames A, client two renames B, concurrently.
    const clientOne = diffFiles(start, rename(start, idA, 'A by one'));
    const clientTwo = diffFiles(start, rename(start, idB, 'B by two'));

    const one = applyRemoteOps(start, { seq: 1, clientId: 'one', ops: clientOne });
    const two = applyRemoteOps(start, { seq: 1, clientId: 'two', ops: clientTwo });

    // Each applies the other's batch: both edits survive on both clients.
    const oneMerged = applyRemoteOps(one.file, { seq: 2, clientId: 'two', ops: clientTwo }, one.state);
    const twoMerged = applyRemoteOps(two.file, { seq: 2, clientId: 'one', ops: clientOne }, two.state);
    expect(names(oneMerged.file)).toEqual(['A by one', 'B by two']);
    expect(names(twoMerged.file)).toEqual(['A by one', 'B by two']);
    expect(names(oneMerged.file)).toEqual(names(twoMerged.file));
  });

  it('converges concurrent edits to the same node regardless of arrival order', () => {
    const start = base();
    const idA = (start.document.children[0]!.children as SceneNode[])[0]!.id;
    const batchOne: StampedOps = { seq: 7, clientId: 'ada', ops: diffFiles(start, rename(start, idA, 'From Ada')) };
    const batchTwo: StampedOps = { seq: 7, clientId: 'grace', ops: diffFiles(start, rename(start, idA, 'From Grace')) };

    // Same sequence (the relay cannot order these), different client ids: the
    // clientId tiebreak decides, identically everywhere.
    const first = applyRemoteBatches(start, [batchOne, batchTwo]);
    const second = applyRemoteBatches(start, [batchTwo, batchOne]);
    expect(names(first.file)).toEqual(names(second.file));
    // The same node on both clients, decided by the clientId tiebreak.
    expect(names(first.file)).toEqual(['From Grace', 'B']);

    // Different sequences: the higher sequence wins on both arrival orders.
    const lower: StampedOps = { ...batchOne, seq: 3 };
    const higher: StampedOps = { ...batchTwo, seq: 9 };
    expect(names(applyRemoteBatches(start, [lower, higher]).file)).toEqual(['From Grace', 'B']);
    expect(names(applyRemoteBatches(start, [higher, lower]).file)).toEqual(['From Grace', 'B']);
  });

  it('merges different fields of the same node instead of dropping one', () => {
    const start = base();
    const idA = (start.document.children[0]!.children as SceneNode[])[0]!.id;
    // One client renames, the other moves the same node.
    const renameBatch: StampedOps = { seq: 1, clientId: 'ada', ops: diffFiles(start, rename(start, idA, 'Moved and named')) };
    const moveBatch: StampedOps = { seq: 2, clientId: 'grace', ops: diffFiles(start, move(start, idA, 99)) };

    const merged = applyRemoteBatches(start, [renameBatch, moveBatch]);
    const node = findNode(merged.file.document, idA) as SceneNode;
    expect(node.name).toBe('Moved and named');
    expect(node.transform.tx).toBe(99);
  });

  it('never touches nodes no batch mentions', () => {
    const start = base();
    const ids = (start.document.children[0]!.children as SceneNode[]).map((node) => node.id);
    const [idA, idB] = ids as [string, string];
    // Locally, client two renames B while a remote batch patches A.
    const local = rename(start, idB, 'Local B');
    const remote: StampedOps = { seq: 5, clientId: 'ada', ops: diffFiles(start, rename(start, idA, 'Remote A')) };
    const merged = applyRemoteOps(local, remote);
    expect(names(merged.file)).toEqual(['Remote A', 'Local B']);
  });

  it('lets a removal win over a patch and applies it everywhere', () => {
    const start = base();
    const idA = (start.document.children[0]!.children as SceneNode[])[0]!.id;
    const removed = {
      ...start,
      document: {
        ...start.document,
        children: [{ ...start.document.children[0]!, children: [start.document.children[0]!.children[1]!] }],
      },
    } as PigmaFile;
    const removeBatch: StampedOps = { seq: 4, clientId: 'ada', ops: diffFiles(start, removed) };
    const patchBatch: StampedOps = { seq: 2, clientId: 'grace', ops: diffFiles(start, rename(start, idA, 'Too late')) };

    const merged = applyRemoteBatches(start, [removeBatch, patchBatch]);
    expect(merged.file.document.children[0]!.children).toHaveLength(1);
    expect(findNode(merged.file.document, idA)).toBeNull();
    // The same result when the stale patch arrives first.
    const other = applyRemoteBatches(start, [patchBatch, removeBatch]);
    expect(other.file.document.children[0]!.children).toHaveLength(1);
  });

  it('merges a room snapshot without discarding newer local work', () => {
    const start = base();
    const idA = (start.document.children[0]!.children as SceneNode[])[0]!.id;
    const snapshotFile = rename(start, idA, 'From the room');
    const local = rename(start, idA, 'Local edit');
    // The local edit is stamped as made after sequence 5.
    const state = applyLocalOps(start, local, { seq: 5, clientId: 'me' });

    // The snapshot is older than the local edit: the local value stands.
    const older = mergeSnapshot(local, { file: snapshotFile, seq: 1, clientId: 'room' }, state);
    expect(names(older.file)).toEqual(['Local edit', 'B']);

    // A newer snapshot wins, and re-applying it is idempotent.
    const newer = mergeSnapshot(local, { file: snapshotFile, seq: 9, clientId: 'room' }, older.state);
    expect(names(newer.file)).toEqual(['From the room', 'B']);
    const again = mergeSnapshot(newer.file, { file: snapshotFile, seq: 9, clientId: 'room' }, newer.state);
    expect(again.file).toBe(newer.file);
    expect(EMPTY_CONVERGENCE.fields).toEqual({});
  });
});
