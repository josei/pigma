import { parseFile, serializeFile } from '../model/serialize';
import { PIGMA_FILE_TYPES, pigmaFileName } from '../model/format';
import type { PigmaFile } from '../model/types';

/**
 * File System Access (P5).
 *
 * Chromium can open and save real files with a retained handle, so the editor
 * can autosave back into the file the user picked. Everywhere else the same
 * actions degrade to an upload/download pair. The pure half (serialize/parse) is
 * shared by both paths so the JSON on disk is identical either way.
 */

/** A handle from the open picker: readable *and* writable, like the real API. */
export interface OpenFileHandleLike extends FileHandleLike {
  getFile: () => Promise<File>;
}

export interface FilePickerWindow {
  showOpenFilePicker?: (options?: unknown) => Promise<OpenFileHandleLike[]>;
  showSaveFilePicker?: (options?: unknown) => Promise<FileHandleLike>;
}

export interface FileHandleLike {
  name: string;
  createWritable: () => Promise<{ write: (data: string | Blob) => Promise<void>; close: () => Promise<void> }>;
}

/**
 * The native `.pigma` type first, the legacy JSON type second: new files are
 * written as `.pigma`, and every `.json` document ever exported still opens.
 */
const PICKER_TYPES = PIGMA_FILE_TYPES;

/** True when this browser can open and save real files. */
export function supportsFileSystemAccess(target: unknown = globalThis): boolean {
  const window = target as FilePickerWindow;
  return typeof window?.showOpenFilePicker === 'function' && typeof window?.showSaveFilePicker === 'function';
}

/** Serialize a document for disk (the same bytes the JSON export produces). */
export function serializeForDisk(file: PigmaFile): string {
  return serializeFile(file);
}

/** Parse a document read from disk, with the importer's validation and messages. */
export function parseFromDisk(text: string): { file: PigmaFile | null; errors: string[] } {
  const result = parseFile(text);
  return { file: result.file ?? null, errors: result.errors };
}

/** Suggested file name for a document (native `.pigma`, unless already named). */
export function diskFileName(name: string): string {
  return pigmaFileName(name);
}

/**
 * Ask for a file to open. Returns null when the user cancels; throws when the
 * picker itself fails (so callers can fall back to an upload input).
 */
export async function openFileFromDisk(
  target: unknown = globalThis,
): Promise<{ handle: OpenFileHandleLike; file: PigmaFile } | null> {
  const window = target as FilePickerWindow;
  if (typeof window?.showOpenFilePicker !== 'function') return null;
  const [handle] = (await window.showOpenFilePicker({ types: PICKER_TYPES, multiple: false, excludeAcceptAllOption: false })) ?? [];
  if (!handle) return null;
  const file = await handle.getFile();
  const parsed = parseFromDisk(await file.text());
  if (!parsed.file) throw new Error(parsed.errors[0] ?? 'That file is not a Pigma document');
  return { handle, file: parsed.file };
}

/** Write the document through an existing handle (the autosave path). */
export async function writeToHandle(handle: FileHandleLike, file: PigmaFile): Promise<void> {
  const writable = await handle.createWritable();
  try {
    await writable.write(serializeForDisk(file));
  } finally {
    await writable.close();
  }
}

/**
 * Ask where to save, then write. Returns the retained handle, or null when the
 * picker is unavailable/cancelled.
 */
export async function saveFileToDisk(
  file: PigmaFile,
  target: unknown = globalThis,
  suggestedName?: string,
): Promise<FileHandleLike | null> {
  const window = target as FilePickerWindow;
  if (typeof window?.showSaveFilePicker !== 'function') return null;
  const handle = await window.showSaveFilePicker({
    suggestedName: diskFileName(suggestedName ?? file.name),
    types: PICKER_TYPES,
  });
  await writeToHandle(handle, file);
  return handle;
}
