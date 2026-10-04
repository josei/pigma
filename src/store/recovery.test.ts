import { beforeEach, describe, expect, it } from 'vitest';
import { useEditor } from './editorStore';
import { MemoryDocumentStore, type DocumentStore, type StoredDocument } from './documentLibrary';
import {
  clearSafetyCopy,
  hasUnsavedEdits,
  markDirty,
  markRoomTouched,
  persistNow,
  readLegacyPayload,
  restorePersistedDocument,
  setDocumentStore,
  writeSafetyCopy,
} from './persistence';
import { emptyFile } from '../model/validate';
import { createRectNode } from '../model/factory';
import type { PigmaFile } from '../model/types';

/** Minimal in-memory localStorage, since node has none. */
function installStorage(): Map<string, string> {
  const map = new Map<string, string>();
  const shim = {
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, String(value)),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
  } as unknown as Storage;
  (globalThis as unknown as { localStorage: Storage }).localStorage = shim;
  return map;
}

const SAFETY_KEY = 'pigma:document:v1';
const POINTER_KEY = 'pigma:last-document:v1';

function scene(name: string): PigmaFile {
  const file = emptyFile(name);
  file.document.children[0]!.children = [createRectNode(null, 1, 2, 3, 4)];
  return file;
}

function stored(patch: Partial<StoredDocument> = {}): StoredDocument {
  return {
    id: 'doc-1',
    name: 'Library doc',
    createdAt: 10,
    savedAt: 1000,
    file: scene('Library doc'),
    pageId: 'page',
    viewport: { x: 0, y: 0, zoom: 1 },
    ...patch,
  };
}

function marker(savedAt: number, name: string) {
  return { schema: 'pigma/persist/1', savedAt, file: scene(name), pageId: '', viewport: { x: 0, y: 0, zoom: 1 } };
}

describe('crash-marker recovery', () => {
  let storage: Map<string, string>;
  let store: MemoryDocumentStore;

  beforeEach(() => {
    storage = installStorage();
    store = new MemoryDocumentStore();
    setDocumentStore(store);
    useEditor.setState({
      file: scene('Editor'),
      documents: [],
      activeDocumentId: null,
      toasts: [],
      past: [],
      future: [],
      transaction: null,
      selection: [],
    });
  });

  it('prefers a marker that is newer than the library record', async () => {
    await store.put(stored({ savedAt: 1000 }));
    storage.set(POINTER_KEY, 'doc-1');
    storage.set(SAFETY_KEY, JSON.stringify(marker(2000, 'Crashed work')));

    expect(await restorePersistedDocument()).toBe(true);
    expect(useEditor.getState().file.name).toBe('Crashed work');
    expect(useEditor.getState().activeDocumentId).toBe('doc-1');
    // The recovered content replaced the library record and the marker is gone.
    expect((await store.get('doc-1'))!.file.name).toBe('Crashed work');
    expect(storage.has(SAFETY_KEY)).toBe(false);
    expect(useEditor.getState().toasts.map((toast) => toast.message).join(' ')).toContain('Recovered');
  });

  it('never lets a stale marker overwrite a newer library record', async () => {
    await store.put(stored({ savedAt: 5000 }));
    storage.set(POINTER_KEY, 'doc-1');
    storage.set(SAFETY_KEY, JSON.stringify(marker(1000, 'Stale copy')));

    expect(await restorePersistedDocument()).toBe(true);
    expect(useEditor.getState().file.name).toBe('Library doc');
    expect((await store.get('doc-1'))!.file.name).toBe('Library doc');
    // The stale marker is dropped rather than replayed.
    expect(storage.has(SAFETY_KEY)).toBe(false);
  });

  it('does not report a recovery when nothing was lost', async () => {
    await store.put(stored({ savedAt: 5000 }));
    storage.set(POINTER_KEY, 'doc-1');

    expect(await restorePersistedDocument()).toBe(true);
    expect(useEditor.getState().toasts).toEqual([]);
    expect(useEditor.getState().file.name).toBe('Library doc');
  });

  it('clears the marker once the library write lands', async () => {
    // A crash copy of the *open* document: same document id, so the save covers it.
    const open = useEditor.getState().file;
    storage.set(SAFETY_KEY, JSON.stringify({ ...marker(1000, 'Editor'), file: open }));
    // The library only saves documents the user worked on, and the boot restore
    // has to have finished before a save may clear the marker.
    await restorePersistedDocument();
    useEditor.getState().apply('user edit', (file) => ({ ...file, name: 'Editor (edited)' }));
    await persistNow();
    expect(storage.has(SAFETY_KEY)).toBe(false);
    expect(readLegacyPayload()).toBeNull();
    // The library now holds the document that was open.
    expect((await store.list())[0]!.file.name).toBe('Editor (edited)');
  });

  it('stays dirty when an edit lands while a save is in flight', async () => {
    // A store whose write can be held open, so an edit can arrive mid-save.
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = new MemoryDocumentStore();
    const original = slow.put.bind(slow);
    setDocumentStore({
      list: () => slow.list(),
      get: (id) => slow.get(id),
      put: async (document) => {
        await gate;
        await original(document);
      },
      delete: (id) => slow.delete(id),
    });

    useEditor.setState({ file: scene('First'), activeDocumentId: 'doc-1', documents: [] });
    await restorePersistedDocument();
    useEditor.getState().apply('user edit', (file) => ({ ...file, name: 'First edit' }));
    const saving = persistNow();
    // The user keeps typing while the write is in flight.
    useEditor.setState({ file: scene('Second') });
    markDirty();
    release!();
    await saving;

    // The write covered "First edit": the newer edit must still count as unsaved.
    expect(hasUnsavedEdits()).toBe(true);
    expect((await slow.get('doc-1'))!.file.name).toBe('First edit');

    // Unload therefore writes a marker, and it carries the newer document.
    writeSafetyCopy();
    expect(JSON.parse(storage.get(SAFETY_KEY)!).file.name).toBe('Second');

    // A save that starts and finishes without an edit does clear the state.
    await persistNow();
    expect(hasUnsavedEdits()).toBe(false);
    expect(storage.has(SAFETY_KEY)).toBe(false);
  });

  it('persists a document whose only changes came from the room', async () => {
    await restorePersistedDocument();
    // No local history and no transaction: the change arrived from a peer.
    expect(useEditor.getState().past).toEqual([]);
    useEditor.setState({ file: scene('From a peer'), activeDocumentId: null, documents: [] });
    markRoomTouched();

    // It counts as work: the library gets it and the unload marker protects it.
    await persistNow();
    const stored = await store.list();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.file.name).toBe('From a peer');
    writeSafetyCopy();
    expect(JSON.parse(storage.get(SAFETY_KEY)!).file.name).toBe('From a peer');

    // The boot restore clears the flag: a document opened fresh is not "room
    // touched", so a later save with no edit and no room does nothing.
    let puts = 0;
    const counting = new MemoryDocumentStore();
    setDocumentStore({
      list: () => counting.list(),
      get: (id) => counting.get(id),
      put: async (document) => {
        puts += 1;
        await counting.put(document);
      },
      delete: (id) => counting.delete(id),
    });
    storage.clear();
    await restorePersistedDocument();
    markDirty();
    await persistNow();
    expect(puts).toBe(0);
  });

  it('does not save a document that came from a link until the user keeps it', async () => {
    await restorePersistedDocument();
    // The user's own document is in the library.
    useEditor.setState({ file: scene('Mine'), activeDocumentId: null, documents: [] });
    useEditor.getState().apply('edit', (file) => ({ ...file, name: 'Mine (edited)' }));
    await persistNow();
    expect((await store.list()).map((entry) => entry.file.name)).toEqual(['Mine (edited)']);

    // A document from `#open=` is loaded clean: on screen, undoable, not saved.
    useEditor.getState().loadLinkedDocument(scene('From a link'), { url: 'https://files.test/a.pigma', name: 'Shared' });
    await persistNow();
    expect(useEditor.getState().linkedSource).toEqual({ url: 'https://files.test/a.pigma', name: 'Shared' });
    expect(useEditor.getState().linkedDirty).toBe(false);
    // The local document is untouched, and the link's document is not written.
    expect((await store.list()).map((entry) => entry.file.name)).toEqual(['Mine (edited)']);

    // Editing it makes it the user's own, and it is saved from then on.
    useEditor.getState().apply('edit', (file) => ({ ...file, name: 'From a link (edited)' }));
    expect(useEditor.getState().linkedDirty).toBe(true);
    await persistNow();
    expect((await store.list()).map((entry) => entry.file.name).sort()).toEqual(['From a link (edited)', 'Mine (edited)']);
  });

  it('keeps a linked document when the user says so', async () => {
    await restorePersistedDocument();
    useEditor.getState().loadLinkedDocument(scene('Kept'), { url: 'https://files.test/b.pigma' });
    expect(useEditor.getState().linkedDirty).toBe(false);
    useEditor.getState().keepLinkedDocument();
    expect(useEditor.getState().linkedDirty).toBe(true);
    await persistNow();
    expect((await store.list()).map((entry) => entry.file.name)).toEqual(['Kept']);
  });

  it('forgets the room once the room is left or another document is opened', async () => {
    const countingStore = (): { puts: () => number; store: DocumentStore } => {
      let puts = 0;
      const inner = new MemoryDocumentStore();
      const store: DocumentStore = {
        list: () => inner.list(),
        get: (id) => inner.get(id),
        put: async (document) => {
          puts += 1;
          await inner.put(document);
        },
        delete: (id) => inner.delete(id),
      };
      return { puts: () => puts, store };
    };
    /** No history, no transaction: only the room flag could make this save. */
    const dirtyOnlySave = async () => {
      useEditor.setState({ past: [], future: [], transaction: null });
      markDirty();
      await persistNow();
    };

    await restorePersistedDocument();
    useEditor.setState({ file: scene('Room work'), activeDocumentId: null, documents: [] });
    markRoomTouched();

    // Leaving the room flushes first: the room's work reaches the library.
    useEditor.getState().leaveRoom();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await store.list()).map((entry) => entry.file.name)).toEqual(['Room work']);
    // Then the session stops treating the open document as room-touched.
    const afterLeave = countingStore();
    setDocumentStore(afterLeave.store);
    await dirtyOnlySave();
    expect(afterLeave.puts()).toBe(0);

    // Same when another document is opened: the outgoing one is flushed, and the
    // new one is not saved by the stale flag.
    const fresh = new MemoryDocumentStore();
    setDocumentStore(fresh);
    useEditor.setState({ file: scene('Second'), activeDocumentId: null, documents: [] });
    markRoomTouched();
    useEditor.getState().newFile();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await fresh.list()).map((entry) => entry.file.name).sort()).toEqual(['Second']);

    const afterNew = countingStore();
    setDocumentStore(afterNew.store);
    await dirtyOnlySave();
    expect(afterNew.puts()).toBe(0);
    expect(useEditor.getState().file.name).toBe('Untitled');
  });

  it('keeps a marker written by the unload path for a crash', () => {
    writeSafetyCopy();
    expect(storage.has(SAFETY_KEY)).toBe(true);
    clearSafetyCopy();
    expect(storage.has(SAFETY_KEY)).toBe(false);
  });

  it('migrates a legacy payload when the library is empty', async () => {
    storage.set(SAFETY_KEY, JSON.stringify(marker(1234, 'Legacy design')));
    expect(await restorePersistedDocument()).toBe(true);
    expect(useEditor.getState().file.name).toBe('Legacy design');
    expect((await store.list()).map((entry) => entry.name)).toEqual(['Legacy design']);
    expect(storage.has(SAFETY_KEY)).toBe(false);
    expect(useEditor.getState().toasts.map((toast) => toast.message).join(' ')).toContain('document library');
  });
});
