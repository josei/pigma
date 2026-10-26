import { describe, expect, it } from 'vitest';
import {
  diskFileName,
  openFileFromDisk,
  parseFromDisk,
  saveFileToDisk,
  serializeForDisk,
  supportsFileSystemAccess,
  writeToHandle,
  type FileHandleLike,
} from './fileSystem';
import { emptyFile } from '../model/validate';
import { createRectNode } from '../model/factory';

/** A handle that records what was written to it. */
function fakeHandle(name = 'design.pigma.json') {
  const writes: string[] = [];
  const handle: FileHandleLike = {
    name,
    createWritable: async () => ({
      write: async (data) => {
        writes.push(String(data));
      },
      close: async () => {},
    }),
  };
  return { handle, writes };
}

describe('file system access', () => {
  it('detects support without assuming the API exists', () => {
    expect(supportsFileSystemAccess({})).toBe(false);
    expect(supportsFileSystemAccess({ showOpenFilePicker: () => {}, showSaveFilePicker: () => {} })).toBe(true);
    expect(supportsFileSystemAccess(globalThis)).toBe(false);
  });

  it('round-trips a document through disk serialization', () => {
    const file = emptyFile('Disk');
    file.document.children[0]!.children = [createRectNode(null, 1, 2, 3, 4)];
    const text = serializeForDisk(file);
    const parsed = parseFromDisk(text);
    expect(parsed.errors).toEqual([]);
    expect(parsed.file!.document.children[0]!.children).toHaveLength(1);
    expect(parseFromDisk('{"nope":true}').file).toBeNull();
    expect(parseFromDisk('not json').errors.length).toBeGreaterThan(0);
  });

  it('offers the native type first and still accepts legacy JSON', async () => {
    const calls: unknown[] = [];
    const target = {
      showOpenFilePicker: async (options?: unknown) => {
        calls.push(options);
        return [];
      },
      showSaveFilePicker: async (options?: unknown) => {
        calls.push(options);
        throw new Error('cancelled');
      },
    };
    await openFileFromDisk(target);
    const open = calls[0] as { types: Array<{ accept: Record<string, string[]> }> };
    expect(Object.keys(open.types[0]!.accept)).toEqual(['application/vnd.pigma+json']);
    expect(open.types[0]!.accept['application/vnd.pigma+json']).toEqual(['.pigma']);
    expect(open.types[1]!.accept).toEqual({ 'application/json': ['.json'] });

    await saveFileToDisk(emptyFile('My design'), target).catch(() => null);
    const save = calls[1] as { suggestedName: string; types: unknown };
    expect(save.suggestedName).toBe('My-design.pigma');
    expect(save.types).toEqual(open.types);
  });

  it('suggests a safe file name', () => {
    // New saves use the native extension; a name the user already extended keeps it.
    expect(diskFileName('My design')).toBe('My-design.pigma');
    expect(diskFileName('My design.json')).toBe('My-design.json');
    expect(diskFileName('My design.pigma')).toBe('My-design.pigma');
    // `safeFileName` falls back to "pigma" for an empty name.
    expect(diskFileName('   ')).toBe('pigma.pigma');
  });

  it('writes through a retained handle and always closes the writable', async () => {
    const { handle, writes } = fakeHandle();
    let closed = false;
    const tracked: FileHandleLike = { ...handle, createWritable: async () => ({ write: async (data) => { writes.push(String(data)); }, close: async () => { closed = true; } }) };
    await writeToHandle(tracked, emptyFile('Autosave'));
    expect(writes[0]).toContain('"schema": "pigma/1"');
    expect(closed).toBe(true);
  });

  it('closes the writable even when the write fails', async () => {
    let closed = false;
    const handle: FileHandleLike = {
      name: 'broken',
      createWritable: async () => ({
        write: async () => {
          throw new Error('disk full');
        },
        close: async () => {
          closed = true;
        },
      }),
    };
    await expect(writeToHandle(handle, emptyFile('X'))).rejects.toThrow('disk full');
    expect(closed).toBe(true);
  });

  it('opens a picked file and reports a bad one', async () => {
    const good = serializeForDisk(emptyFile('Picked'));
    const { handle } = fakeHandle('picked.json');
    const picker = {
      showOpenFilePicker: async () => [
        { ...handle, getFile: async () => new File([good], 'picked.json', { type: 'application/json' }) },
      ],
    };
    const opened = await openFileFromDisk(picker);
    expect(opened!.file.name).toBe('Picked');
    expect(opened!.handle.name).toBe('picked.json');

    const bad = {
      showOpenFilePicker: async () => [{ ...handle, getFile: async () => new File(['{}'], 'x.json') }],
    };
    await expect(openFileFromDisk(bad)).rejects.toThrow();
    expect(await openFileFromDisk({})).toBeNull();
  });

  it('saves through the picker and returns the handle', async () => {
    const { handle, writes } = fakeHandle('chosen.pigma.json');
    const saved = await saveFileToDisk(emptyFile('Save me'), { showSaveFilePicker: async () => handle });
    expect(saved).toBe(handle);
    expect(writes[0]).toContain('"name": "Save me"');
    expect(await saveFileToDisk(emptyFile('X'), {})).toBeNull();
  });
});
