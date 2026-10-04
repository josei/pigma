/**
 * Live editor bridge.
 *
 * The MCP server is driven by a {@link DocumentSession}; this module adapts the
 * real zustand editor store (`src/store/editorStore.ts`) onto that interface so
 * MCP reads and writes act on the open document and the user's selection.
 *
 * `subscribe` is implemented so the browser relay can push every local change
 * (draw, select, undo) to the relay — MCP never serves a stale cache. Writes go
 * through the store's `apply` action, so MCP edits land on the undo stack.
 */
import type { EditorState } from '../store/editorStore';
import type { PigmaFile } from '../model/types';
import { checkRevision, liveSelection, prepareWrite, type DocumentSession } from './session';

/** Structural view of a zustand store, so no zustand import is needed. */
export interface EditorStoreLike {
  getState(): EditorState;
  subscribe(listener: (state: EditorState, previous: EditorState) => void): () => void;
}

/**
 * Adapt the live editor store to a {@link DocumentSession}.
 *
 * `subscribe` fires only when the document or selection actually changes, so
 * viewport/tool churn does not spam the relay.
 */
export function createEditorSession(store: EditorStoreLike): DocumentSession {
  let lastFile: PigmaFile = store.getState().file;
  let lastSelection: string[] = store.getState().selection;
  // The same "revision" the relay path exposes, counted here so an in-process
  // server is guarded too. It tracks the live document, so a caller that read an
  // older revision is refused rather than silently overwriting a local edit.
  let revision = 0;
  // Subscribed eagerly, not only when a bridge subscribes: the revision has to
  // move even for a session nobody is streaming. It keeps its OWN last values —
  // sharing `lastFile`/`lastSelection` with `subscribe` below would make that
  // listener see no change and stop notifying the bridge.
  let seenFile: PigmaFile = lastFile;
  let seenSelection: string[] = lastSelection;
  store.subscribe((state) => {
    if (state.file !== seenFile || state.selection !== seenSelection) {
      seenFile = state.file;
      seenSelection = state.selection;
      revision += 1;
    }
  });

  return {
    getFile: () => store.getState().file,
    getSnapshot: () => ({ file: store.getState().file, revision }),
    setFile: (file: PigmaFile, options) => {
      checkRevision(revision, options?.expectedRevision);
      // The same settle + invariant check the in-memory session runs, and it runs
      // BEFORE the store sees anything: a refused write must leave the document
      // and the undo history untouched, so the throw cannot come from inside
      // `apply`. The store settles again, which is idempotent and free on an
      // already-settled document, and skips a write that changes nothing.
      const settled = prepareWrite(file);
      store.getState().apply('MCP: update document', () => settled);
      // The store owns the selection, and the write replaced the document: drop
      // ids that no longer resolve so the harness AND the editor agree. `select`
      // is not a document edit, so this adds no history entry.
      const state = store.getState();
      const live = liveSelection(state.file, state.selection);
      if (live.length !== state.selection.length) store.getState().select(live, 'replace');
    },
    getSelection: () => liveSelection(store.getState().file, store.getState().selection),
    setSelection: (ids: string[], options) => {
      checkRevision(revision, options?.expectedRevision);
      store.getState().select(ids, 'replace');
    },
    subscribe: (listener) =>
      store.subscribe((state) => {
        if (state.file !== lastFile || state.selection !== lastSelection) {
          lastFile = state.file;
          lastSelection = state.selection;
          listener();
        }
      }),
  };
}

