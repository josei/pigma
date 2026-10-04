import { describe, expect, it } from 'vitest';
import {
  AUTO_SNAPSHOT_EDITS,
  VERSION_LIMIT,
  deleteVersion,
  latestVersion,
  prune,
  renameVersion,
  saveAutoVersion,
  saveVersion,
  shouldAutoSnapshot,
  versionContent,
  versionsOf,
} from './versions';
import { createRectNode } from './factory';
import { emptyFile } from './validate';
import { findNode } from './tree';
import { parseFile, serializeFile } from './serialize';
import type { PigmaFile } from './types';

function withRect(file: PigmaFile, name: string): PigmaFile {
  const page = file.document.children[0]!;
  const node = createRectNode(null, 0, 0, 50, 50);
  node.name = name;
  page.children = [...page.children, node];
  return { ...file, document: { ...file.document, children: [page] } };
}

describe('version history', () => {
  it('saves named versions with a content snapshot', () => {
    const file = withRect(emptyFile('Versions'), 'First');
    const saved = saveVersion(file, 'Milestone');
    expect(versionsOf(saved.file)).toHaveLength(1);
    const entry = versionsOf(saved.file)[0]!;
    expect(entry.name).toBe('Milestone');
    expect(entry.auto).toBe(false);
    expect((entry.snapshot.document.children[0]!.children as { name: string }[]).map((child) => child.name)).toEqual(['First']);
    expect(latestVersion(saved.file)?.id).toBe(saved.versionId);
  });

  it('names versions automatically when none is given', () => {
    const file = emptyFile('Versions');
    const first = saveVersion(file);
    const second = saveVersion(first.file);
    expect(versionsOf(second.file).map((entry) => entry.name)).toEqual(['Version 1', 'Version 2']);
  });

  it('restores a snapshot without touching the history itself', () => {
    const file = withRect(emptyFile('Versions'), 'Original');
    const saved = saveVersion(file, 'One');
    const changed = withRect(saved.file, 'Later');
    expect(findNode(changed.document, changed.document.children[0]!.children[1]!.id)).not.toBeNull();

    const content = versionContent(changed, saved.versionId)!;
    expect(content.document.children[0]!.children).toHaveLength(1);
    // The restored content keeps the file's own version list.
    expect(versionsOf(content)).toHaveLength(1);
    expect(content).not.toBe(changed);
    // Restoring twice from the same version is stable.
    expect(versionContent(changed, saved.versionId)!.document.children[0]!.children).toHaveLength(1);
  });

  it('takes auto snapshots once the edit count passes the threshold', () => {
    const file = emptyFile('Versions');
    expect(shouldAutoSnapshot(AUTO_SNAPSHOT_EDITS - 1)).toBe(false);
    expect(shouldAutoSnapshot(AUTO_SNAPSHOT_EDITS)).toBe(true);
    const auto = saveAutoVersion(file, 'Auto save');
    expect(versionsOf(auto.file)[0]).toMatchObject({ auto: true, name: 'Auto save' });
    // Renaming an auto snapshot promotes it to a named version.
    const promoted = renameVersion(auto.file, auto.versionId, 'Keep me');
    expect(versionsOf(promoted)[0]).toMatchObject({ auto: false, name: 'Keep me' });
    expect(renameVersion(promoted, auto.versionId, '  ').versions).toBe(promoted.versions);
  });

  it('prunes auto snapshots before named versions', () => {
    const entries = Array.from({ length: VERSION_LIMIT + 3 }, (_, index) => ({
      id: `v${index}`,
      name: `V${index}`,
      createdAt: index,
      auto: index % 2 === 0,
      snapshot: {} as never,
    }));
    const pruned = prune(entries);
    expect(pruned).toHaveLength(VERSION_LIMIT);
    // The three dropped entries are all auto snapshots, so every named version survives.
    const dropped = entries.filter((entry) => !pruned.some((kept) => kept.id === entry.id));
    expect(dropped).toHaveLength(3);
    expect(dropped.every((entry) => entry.auto)).toBe(true);
    expect(pruned[0]!.id).toBe('v1');
    expect(pruned.at(-1)!.id).toBe(`v${VERSION_LIMIT + 2}`);
    expect(prune(entries.slice(0, 3))).toHaveLength(3);
  });

  it('deletes versions', () => {
    const file = emptyFile('Versions');
    const saved = saveVersion(file, 'Gone');
    expect(deleteVersion(saved.file, saved.versionId).versions).toEqual([]);
  });

  it('round-trips the version history through JSON', () => {
    const file = withRect(emptyFile('Versions'), 'Snapshot me');
    const saved = saveVersion(file, 'Milestone');
    const restored = parseFile(serializeFile(saved.file));
    expect(restored.ok).toBe(true);
    const versions = versionsOf(restored.file!);
    expect(versions).toHaveLength(1);
    expect(versions[0]!.name).toBe('Milestone');
    expect(versions[0]!.snapshot.document.children[0]!.children).toHaveLength(1);
  });
});
