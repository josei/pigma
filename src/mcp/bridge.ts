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
import { prepareWrite, type DocumentSession } from './session';

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

  return {
    getFile: () => store.getState().file,
    setFile: (file: PigmaFile) => {
      // The same settle + invariant check the in-memory session runs, and it runs
      // BEFORE the store sees anything: a refused write must leave the document
      // and the undo history untouched, so the throw cannot come from inside
      // `apply`. The store settles again, which is idempotent and free on an
      // already-settled document, and skips a write that changes nothing.
      const settled = prepareWrite(file);
      store.getState().apply('MCP: update document', () => settled);
    },
    getSelection: () => [...store.getState().selection],
    setSelection: (ids: string[]) => {
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

