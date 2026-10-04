import type { Library } from '../model/library';
import { BUILTIN_PLUGINS } from '../plugins/builtins';
import { mergePlugins, persistablePlugins, type PluginRecord } from '../plugins/registry';
import type { PigmaFile } from '../model/types';
import { validatePigmaFile } from '../model/validate';
import { documentProblems } from '../model/invariants';
import { PIGMA_FORMAT, pigmaFileName } from '../model/format';
import { nextNodeId } from '../model/ids';
import { writeToHandle } from './fileSystem';
import { defaultDocument } from '../model/starter';
import {
  IndexedDbDocumentStore,
  duplicateDocument,
  migrateLegacyDocument,
  nextDocumentName,
  normalizeDocumentName,
  toSummaries,
  type DocumentStore,
  type DocumentSummary,
  type LegacyPayload,
  type StoredDocument,
} from './documentLibrary';
import { closeBurst, syncLocalEditsToRoom, useEditor, type Viewport } from './editorStore';

/**
 * Local persistence.
 *
 * Documents live in a small library (IndexedDB, see documentLibrary.ts) so a
 * browser can hold many named files instead of one. The editor autosaves the
 * open document (debounced), remembers which one was open, and migrates the old
 * single-key localStorage payload the first time it runs. Imported Figma
 * documents round-trip through the same validator as the JSON importer, so
 * unsupported fields survive untouched.
 */
/**
 * Crash-recovery marker: a synchronous copy of the open document.
 *
 * IndexedDB writes cannot be awaited from `beforeunload`, so the unload path
 * mirrors the document into localStorage (the key the old single-document build
 * used). It is *removed again* as soon as the library write lands, so a present
 * marker means "the previous session ended without finishing its library write".
 * Boot only replays it when it is strictly newer than the library record, which
 * is what keeps a stale copy from overwriting newer work.
 */
const STORAGE_KEY = 'pigma:document:v1';
/** Pointer to the document that was open, so a reload lands in the same place. */
const LAST_DOCUMENT_KEY = 'pigma:last-document:v1';
const SAVE_DELAY_MS = 350;

export interface PersistedDocument {
  schema: 'pigma/persist/1';
  savedAt: number;
  file: PigmaFile;
  pageId: string;
  viewport: Viewport;
  /** Published libraries live beside the document (M11). */
  libraries: Library[];
  /** Side panel widths (M9). */
  panelWidths?: { left: number; right: number };
  /** User-authored plugins (M15); built-ins come from the app. */
  plugins?: PluginRecord[];
}



function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}


/** The document store the editor uses (IndexedDB in the browser). */
let documentStore: DocumentStore = new IndexedDbDocumentStore();

/**
 * Edit accounting.
 *
 * A monotonic counter, not a boolean: a save that started before an edit must not
 * clear the "unsaved" state when it finishes, or an edit arriving mid-save would
 * be silently unprotected at unload. `edits` counts every change; `saved` is the
 * count the last successful library write covered, so `hasUnsavedEdits()` means
 * exactly "the library does not have the current document".
 */
let edits = 0;
let saved = 0;

/**
 * True once the boot restore has finished. Until then an early autosave (the
 * font pass re-measures text right after mount) must not clear the crash marker
 * or claim the marker's document was handled — the restore has not read it yet.
 */
let bootComplete = false;

/** Mark the open document as changed (called by the persistence subscription). */
export function markDirty(): void {
  edits += 1;
}

/** True while the library copy is behind the open document. */
export function hasUnsavedEdits(): boolean {
  return edits !== saved;
}

/** Swap the store (tests, or a session that must stay in memory). */
export function setDocumentStore(store: DocumentStore): void {
  documentStore = store;
}

/** Everything the editor persists alongside the document itself. */
function fileMeta(): Pick<PersistedDocument, 'libraries' | 'panelWidths' | 'plugins'> {
  const state = useEditor.getState();
  return {
    libraries: state.libraries,
    panelWidths: state.panelWidths,
    plugins: persistablePlugins(state.plugins),
  };
}

/**
 * Build the record for the currently open document.
 *
 * The name comes from the library, not from the file: a document is named when
 * it is created, and editing its file name must not silently rename it. The
 * lookup falls back to the store because the summary list can lag behind a
 * freshly created document.
 */
export async function snapshotDocument(now = Date.now()): Promise<StoredDocument> {
  const state = useEditor.getState();
  const id = state.activeDocumentId ?? nextNodeId();
  const known = state.documents.find((entry) => entry.id === id);
  const existing = known ?? (await documentStore.get(id));
  const name = existing?.name ?? state.file.name;
  return {
    id,
    name,
    createdAt: existing?.createdAt ?? now,
    savedAt: now,
    file: state.file,
    // The library records what the document is and what it is called on disk:
    // the native format and its `.pigma` name, so a document opened from the
    // library exports under the same name it was stored with.
    format: PIGMA_FORMAT,
    fileName: pigmaFileName(name),
    pageId: state.pageId,
    viewport: state.viewport,
    ...fileMeta(),
  };
}

/**
 * True once the user has actually changed the document. The library only holds
 * documents someone worked on: a freshly loaded starter (whose text is merely
 * re-measured when fonts arrive) is not saved, so an untouched document never
 * takes a library slot — and a legacy document in the old key still finds an
 * empty library to be adopted into.
 */
function userEdited(): boolean {
  const state = useEditor.getState();
  // A document opened from a `#open=` link is not the user's local document: it
  // stays on screen (and undoable) but is not written to the library, and does
  // not touch the crash marker, until they edit it or save it themselves.
  if (state.linkedSource && !state.linkedDirty) return false;
  // A room session counts too: a document whose only changes arrived from other
  // participants (remote ops or a snapshot) is still work someone did, and must
  // reach the library and the crash marker like any other edit.
  return state.past.length > 0 || state.transaction !== null || roomTouched;
}

/**
 * Set when a room session changes the open document. Cleared by the boot restore
 * (a freshly opened document has not been touched by a room yet).
 */
let roomTouched = false;

/** Record that the room changed the open document (remote ops or snapshot). */
export function markRoomTouched(): void {
  roomTouched = true;
  markDirty();
}

/**
 * Forget that the room touched the open document. Called when the room is left
 * and when a different document is opened: from then on the session's edits are
 * what decides whether it is worth saving, so one room session cannot make every
 * later document look edited. Flush first (see the callers) so work that only
 * arrived from the room still reaches the library.
 */
export function clearRoomTouched(): void {
  roomTouched = false;
}

/** Write the open document to the library, debounced by the caller. */
export async function persistNow(): Promise<void> {
  const state = useEditor.getState();
  if (!userEdited()) return;
  const startedAt = edits;
  const record = await snapshotDocument();
  try {
    await documentStore.put(record);
  } catch {
    // Storage full or unavailable: keep the session usable.
    useEditor.getState().pushToast('Could not save this document locally');
    return;
  }
  const pointer = storage();
  try {
    pointer?.setItem(LAST_DOCUMENT_KEY, record.id);
  } catch {
    // A blocked localStorage only costs the "reopen last document" nicety.
  }
  // The library write landed — but only for the document as it was when the
  // write *started*. An edit that arrived while it was in flight stays unsaved.
  if (bootComplete && edits === startedAt) {
    saved = startedAt;
    // A save covers this document; a legacy document from another file is left
    // for the boot restore to adopt.
    if (markerBelongsTo(record.file)) clearSafetyCopy();
  }
  if (state.activeDocumentId !== record.id || state.documents.some((entry) => entry.id === record.id) === false) {
    const summaries = toSummaries(await documentStore.list());
    useEditor.setState({ activeDocumentId: record.id, documents: summaries });
  }
}

/** Load a stored record into the editor. */
/**
 * A different document is about to be open: save the outgoing one first (work
 * that only arrived from the room must not be dropped), then forget the room.
 */
function switchDocument(): void {
  void persistNow();
  clearRoomTouched();
  // A different document is open: any open burst belonged to the old one.
  closeBurst();
}

/** Whether a file carries a document this app can actually open. */
function isLoadable(file: PigmaFile | null | undefined): file is PigmaFile {
  return !!file && typeof file === 'object' && Array.isArray((file as PigmaFile).document?.children);
}

export function applyDocument(record: StoredDocument): void {
  switchDocument();
  const result = validatePigmaFile(record.file);
  const file = result.ok && result.file ? result.file : record.file;
  if (!result.ok) {
    // The record did not validate, so the RAW file is used rather than the
    // normalised one. Load it anyway — refusing would lock a user out of their
    // own document — but say so: a silent fallback hands the rest of the app a
    // state it considers impossible, and the user never learns why it looks
    // wrong. Same surface as an import failure (a toast), and the problems name
    // the node and the field, exactly as the MCP refusal's do.
    const usable = isLoadable(file);
    const problems = [...result.errors, ...(usable ? documentProblems(file) : [])];
    const shown = problems.slice(0, 3).join('; ');
    const more = problems.length > 3 ? ` (+${problems.length - 3} more)` : '';
    useEditor.getState().pushToast(`Recovered a document with problems: ${shown}${more}`, 'error');
    // Nothing to load: the file has no document to open. Keep the document that
    // is already open rather than assigning a state the rest of the app would
    // fail on, and let the toast carry the reason.
    if (!usable) return;
  }
  useEditor.setState({
    file,
    libraries: record.libraries ?? [],
    ...(record.panelWidths ? { panelWidths: record.panelWidths } : {}),
    plugins: mergePlugins(BUILTIN_PLUGINS, record.plugins ?? []),
    pageId: file.document.children.some((page) => page.id === record.pageId)
      ? record.pageId
      : (file.document.children[0] as { id: string }).id,
    viewport: record.viewport,
    activeDocumentId: record.id,
    selection: [],
    past: [],
    future: [],
    transaction: null,
    editingTextId: null,
    enteredContainerId: null,
    previewVersionId: null,
    previewFile: null,
  });
}

/** Read the documents in the library, newest first. */
export async function listDocuments(): Promise<DocumentSummary[]> {
  return toSummaries(await documentStore.list());
}

/** Open a document by id; returns false when it is gone. */
export async function openDocument(id: string): Promise<boolean> {
  const record = await documentStore.get(id);
  if (!record) return false;
  applyDocument(record);
  return true;
}

/** Create (or reuse) a starter document and open it. */
export async function createDocument(name?: string, file?: PigmaFile): Promise<string> {
  const existing = await documentStore.list();
  const now = Date.now();
  const recordName = normalizeDocumentName(name ?? nextDocumentName(existing));
  const record: StoredDocument = {
    id: nextNodeId(),
    name: recordName,
    createdAt: now,
    savedAt: now,
    file: file ?? defaultDocument(),
    format: PIGMA_FORMAT,
    fileName: pigmaFileName(recordName),
    pageId: '',
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  const pageId = (record.file.document.children[0] as { id: string }).id;
  await documentStore.put({ ...record, pageId });
  applyDocument({ ...record, pageId });
  // Refresh the summaries now: an autosave can land before the next list().
  useEditor.setState({ documents: await listDocuments() });
  return record.id;
}

/** Rename a document in the library. */
export async function renameDocument(id: string, name: string): Promise<void> {
  const record = await documentStore.get(id);
  if (!record) return;
  await documentStore.put({ ...record, name: normalizeDocumentName(name, record.name) });
  useEditor.setState({ documents: await listDocuments() });
}

/** Duplicate a document, opening the copy. */
export async function duplicateDocumentById(id: string): Promise<string | null> {
  const record = await documentStore.get(id);
  if (!record) return null;
  const copy = duplicateDocument(record, nextNodeId(), Date.now());
  await documentStore.put(copy);
  applyDocument(copy);
  return copy.id;
}

/** Delete a document; the caller decides what to open next. */
export async function deleteDocumentById(id: string): Promise<void> {
  await documentStore.delete(id);
  const summaries = await listDocuments();
  useEditor.setState({ documents: summaries });
  if (useEditor.getState().activeDocumentId === id) {
    useEditor.setState({ activeDocumentId: null });
  }
}

/**
 * Boot the library: open the last document, else the newest, else migrate the
 * legacy single-key payload, else start a fresh starter document.
 */
export async function restorePersistedDocument(): Promise<boolean> {
  const pointer = storage();
  let lastId: string | null = null;
  try {
    lastId = pointer?.getItem(LAST_DOCUMENT_KEY) ?? null;
  } catch {
    lastId = null;
  }
  const summaries = await listDocuments();
  useEditor.setState({ documents: summaries });
  const target = (lastId && summaries.find((entry) => entry.id === lastId)) || summaries[0];
  // From here on a completed save may clear the marker: the restore has read it.
  bootComplete = true;
  roomTouched = false;

  // Two shapes can sit in the legacy key, and they mean different things:
  // - a crash marker from this build carries `savedAt`; it is replayed only when
  //   it is strictly newer than the library record, so a stale one can never
  //   overwrite newer work;
  // - a pre-envelope legacy document has no timestamp at all. It is not a marker
  //   for anything in the library, so it is adopted as a *new* document (named
  //   after itself) unless that name is already taken.
  const pending = readLegacyPayload();
  const hasTimestamp = typeof pending?.savedAt === 'number' && pending.savedAt > 0;
  const pendingSavedAt = hasTimestamp ? (pending!.savedAt as number) : 0;
  const knownName =
    pending !== null && !hasTimestamp
      ? summaries.some((entry) => entry.name === normalizeDocumentName(String((pending as { name?: unknown }).name ?? (pending.file as { name?: string } | undefined)?.name ?? ''), 'Recovered document'))
      : false;
  const recovered = pending && !knownName ? migrateLegacyDocument(pending, target?.id ?? nextNodeId(), Date.now()) : null;
  const storedAt = target ? await storedSavedAt(target.id) : 0;
  const adoptAsNew = recovered !== null && !hasTimestamp;
  if (recovered && (adoptAsNew || !target || pendingSavedAt > storedAt)) {
    // A crash marker updates the document it belongs to; a legacy document keeps
    // its own identity (and its own name) in the library.
    const record: StoredDocument = target && !adoptAsNew
      ? { ...recovered, id: target.id, name: target.name, createdAt: target.createdAt }
      : { ...recovered, id: nextNodeId() };
    await documentStore.put(record);
    try {
      pointer?.setItem(LAST_DOCUMENT_KEY, record.id);
    } catch {
      // Ignore: the library copy is already stored.
    }
    clearSafetyCopy();
    applyDocument(record);
    useEditor.setState({ documents: await listDocuments() });
    useEditor.getState().pushToast(
      target ? `Recovered “${record.name}” from your last session` : `Moved “${record.name}” into your document library`,
      'success',
    );
    return true;
  }
  if (recovered) {
    // The library copy is at least as new: drop the marker instead of replaying it.
    clearSafetyCopy();
  }

  if (target) {
    const opened = await openDocument(target.id);
    if (opened) return true;
  }
  return false;
}

/**
 * True when the legacy key holds a crash copy of `file` (same document id), as
 * opposed to a legacy document the library has never seen. Only the former is
 * made redundant by a successful save; the latter must survive until the boot
 * restore adopts it.
 */
function markerBelongsTo(file: PigmaFile): boolean {
  const payload = readLegacyPayload();
  if (!payload) return false;
  const candidate = (typeof payload.file === 'object' && payload.file !== null ? payload.file : payload) as {
    document?: { id?: unknown };
  };
  const id = candidate?.document?.id;
  return typeof id === 'string' && id === file.document.id;
}

/** Drop the crash marker (after a successful library write, or after recovery). */
export function clearSafetyCopy(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(STORAGE_KEY);
  } catch {
    // A blocked localStorage costs nothing here: the marker is only an optimisation.
  }
}

/** Write the crash marker synchronously (the unload path cannot await IndexedDB). */
export function writeSafetyCopy(): void {
  const store = storage();
  if (!store) return;
  const state = useEditor.getState();
  const payload: PersistedDocument = {
    schema: 'pigma/persist/1',
    savedAt: Date.now(),
    file: state.file,
    pageId: state.pageId,
    viewport: state.viewport,
    libraries: state.libraries,
    panelWidths: state.panelWidths,
    plugins: persistablePlugins(state.plugins),
  };
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota exceeded (very large imported documents): the library copy stands.
  }
}

/** When the library last saved this document (0 when unknown). */
async function storedSavedAt(id: string): Promise<number> {
  const record = await documentStore.get(id);
  return record?.savedAt ?? 0;
}

/** The crash marker / legacy payload, when the key holds a valid one. */
export function readLegacyPayload(): LegacyPayload | null {
  const store = storage();
  if (!store) return null;
  const raw = store.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as LegacyPayload) : null;
  } catch {
    return null;
  }
}

/** Autosave writes to the linked file at most this often. */
const FILE_SAVE_DELAY_MS = 1200;

/**
 * Subscribe to document changes and save them, debounced: to the local library
 * always, and back into the linked file when the user opened/saved one through
 * the File System Access API.
 */
/**
 * Share this tab's viewport with the room whenever it changes, so a peer can
 * follow it. A no-op without a room, and throttled by the store.
 */
export function attachRoomViewportSharing(): () => void {
  let last = useEditor.getState().viewport;
  return useEditor.subscribe((state) => {
    if (state.viewport === last) return;
    last = state.viewport;
    state.shareViewport();
  });
}

export function attachPersistence(): () => void {
  if (typeof window === 'undefined') return () => {};
  let timer: number | null = null;
  let fileTimer: number | null = null;
  let fileFailureReported = false;
  const schedule = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      void persistNow();
    }, SAVE_DELAY_MS);
  };
  const scheduleFile = () => {
    if (fileTimer !== null) window.clearTimeout(fileTimer);
    fileTimer = window.setTimeout(() => {
      fileTimer = null;
      const state = useEditor.getState();
      const handle = state.fileHandle;
      if (!handle) return;
      void writeToHandle(handle, state.file).then(
        () => {
          fileFailureReported = false;
        },
        (error: unknown) => {
          if (fileFailureReported) return;
          fileFailureReported = true;
          useEditor.getState().pushToast(`Could not autosave to ${handle.name}: ${String(error)}`);
        },
      );
    }, FILE_SAVE_DELAY_MS);
  };

  const unsubscribe = useEditor.subscribe((state, previous) => {
    if (
      state.file !== previous.file ||
      state.libraries !== previous.libraries ||
      state.panelWidths !== previous.panelWidths ||
      state.plugins !== previous.plugins
    ) {
      markDirty();
      schedule();
      // Rooms are opt-in; this is a no-op with no room joined.
      syncLocalEditsToRoom();
    }
    // Only document edits go back to disk; panel tweaks do not.
    if (state.file !== previous.file && state.fileHandle) scheduleFile();
  });

  // Flush pending writes when the tab goes away so nothing is lost on reload.
  const flush = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    if (fileTimer !== null) {
      window.clearTimeout(fileTimer);
      fileTimer = null;
      const state = useEditor.getState();
      if (state.fileHandle) void writeToHandle(state.fileHandle, state.file).catch(() => {});
    }
    // Synchronous: IndexedDB writes may be cut short by the navigation, so a
    // marker is written only while the document still has unsaved edits — and
    // never over a legacy document the library has not adopted yet (that payload
    // is waiting for the boot restore, not a crash copy of this session).
    const state = useEditor.getState();
    const pending = readLegacyPayload();
    if (userEdited() && hasUnsavedEdits() && (pending === null || markerBelongsTo(state.file))) writeSafetyCopy();
    void persistNow();
  };
  window.addEventListener('beforeunload', flush);

  return () => {
    unsubscribe();
    window.removeEventListener('beforeunload', flush);
    flush();
  };
}
