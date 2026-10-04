import type { PigmaFile, VersionEntry } from './types';
import { nextNodeId } from './ids';

/**
 * Version history (M6).
 *
 * A version stores a content snapshot (everything but the history itself), so a
 * restore is a plain, diff-free replacement that goes through the normal store
 * pipeline and therefore becomes a new undoable history entry.
 *
 * Auto snapshots are taken once the document has moved on by a number of edits,
 * and are pruned before named versions when the history is full.
 */

export const VERSION_LIMIT = 12;
export const AUTO_SNAPSHOT_EDITS = 8;

export function versionsOf(file: PigmaFile): VersionEntry[] {
  return file.versions ?? [];
}

function snapshotOf(file: PigmaFile): VersionEntry['snapshot'] {
  const { versions: _versions, ...rest } = file;
  return structuredClone(rest);
}

/** Save a named version. */
export function saveVersion(file: PigmaFile, name?: string): { file: PigmaFile; versionId: string } {
  const versions = versionsOf(file);
  const entry: VersionEntry = {
    id: nextNodeId(),
    name: name?.trim() || `Version ${versions.length + 1}`,
    createdAt: Date.now(),
    auto: false,
    snapshot: snapshotOf(file),
  };
  return { file: { ...file, versions: prune([...versions, entry]) }, versionId: entry.id };
}

/** Save an automatic snapshot (called when the edit count passes the threshold). */
export function saveAutoVersion(file: PigmaFile, label = 'Auto save'): { file: PigmaFile; versionId: string } {
  const versions = versionsOf(file);
  const entry: VersionEntry = {
    id: nextNodeId(),
    name: label,
    createdAt: Date.now(),
    auto: true,
    snapshot: snapshotOf(file),
  };
  return { file: { ...file, versions: prune([...versions, entry]) }, versionId: entry.id };
}

/**
 * Keep at most `limit` entries, preserving document order. When the history is
 * over the cap the oldest *auto* snapshots go first, so a named version is only
 * ever dropped once no auto snapshots are left.
 */
export function prune(versions: VersionEntry[], limit = VERSION_LIMIT): VersionEntry[] {
  if (versions.length <= limit) return versions;
  const dropCount = versions.length - limit;
  const doomed = new Set<string>();
  for (const entry of versions.filter((candidate) => candidate.auto)) {
    if (doomed.size >= dropCount) break;
    doomed.add(entry.id);
  }
  for (const entry of versions) {
    if (doomed.size >= dropCount) break;
    if (!entry.auto) doomed.add(entry.id);
  }
  return versions.filter((entry) => !doomed.has(entry.id));
}

/** Content of a version, ready to be handed to the store's load pipeline. */
export function versionContent(file: PigmaFile, versionId: string): PigmaFile | null {
  const entry = versionsOf(file).find((candidate) => candidate.id === versionId);
  if (!entry) return null;
  return { ...structuredClone(entry.snapshot), versions: versionsOf(file) };
}

export function renameVersion(file: PigmaFile, versionId: string, name: string): PigmaFile {
  if (name.trim() === '') return file;
  return {
    ...file,
    versions: versionsOf(file).map((entry) => (entry.id === versionId ? { ...entry, name: name.trim(), auto: false } : entry)),
  };
}

export function deleteVersion(file: PigmaFile, versionId: string): PigmaFile {
  return { ...file, versions: versionsOf(file).filter((entry) => entry.id !== versionId) };
}

export function latestVersion(file: PigmaFile): VersionEntry | null {
  const versions = versionsOf(file);
  return versions.length > 0 ? (versions[versions.length - 1] as VersionEntry) : null;
}

/** True when the edit count since the newest version justifies an auto snapshot. */
export function shouldAutoSnapshot(editsSinceSnapshot: number): boolean {
  return editsSinceSnapshot >= AUTO_SNAPSHOT_EDITS;
}
