/**
 * Editor bridge for the MCP server.
 *
 * The server never owns a document: it reads and writes through a
 * {@link DocumentSession}. The running editor implements this interface so MCP
 * tools act on the live document; tests use `createSession` in memory.
 *
 * Writes may be asynchronous (the browser bridge awaits the editor's ACK), and
 * a session may expose `subscribe` so the bridge can push live state instead of
 * serving a stale cache.
 */
import type { AnyNode, PigmaFile, SceneNode } from '../model/types';
import { isSceneNode } from '../model/types';
import { findNode, descendants } from '../model/tree';
import { settleDocument } from '../model/settle';
import { McpToolError } from './errors';
import { documentProblems } from './invariants';

export interface DocumentWriteOptions {
  /** Revision the caller read; the editor rejects a stale write. */
  expectedRevision?: number;
}

export interface DocumentSession {
  getFile(): PigmaFile | null;
  setFile(file: PigmaFile, options?: DocumentWriteOptions): void | Promise<void>;
  getSelection(): string[];
  setSelection(ids: string[], options?: DocumentWriteOptions): void | Promise<void>;
  /** Optional: notify the bridge of local changes (draw/select/undo). */
  subscribe?(listener: () => void): () => void;
  /**
   * Optional: authoritative file + revision snapshot for this call. The browser
   * bridge performs a round trip so a write always carries the editor's current
   * revision rather than a possibly-stale mirror.
   */
  getSnapshot?(): Promise<DocumentSnapshot> | DocumentSnapshot;
}

export interface DocumentSnapshot {
  file: PigmaFile | null;
  revision: number;
}

/**
 * Settle a document and refuse it when it breaks the invariants.
 *
 * Every MCP write goes through this, whichever session it lands on, so the
 * guarantee cannot differ between the in-memory session and the live editor.
 * Settling first matters: a pass could itself produce a problem, and what gets
 * committed is the settled document.
 *
 * `settleDocument` is pure and idempotent — it returns the *same* file object
 * when no pass changed anything, so repeated writes cannot churn — and the throw
 * happens before anything is assigned, so a refused write leaves the previous
 * document (and, on the editor session, its undo history) untouched.
 */
export function prepareWrite(next: PigmaFile): PigmaFile {
  const settled = settleDocument(next);
  const problems = documentProblems(settled);
  if (problems.length > 0) {
    const shown = problems.slice(0, 3).join('; ');
    const more = problems.length > 3 ? ` (+${problems.length - 3} more)` : '';
    throw new McpToolError(`The document this write would produce is invalid: ${shown}${more}`);
  }
  return settled;
}

/** In-memory session, used by tests and by servers started with a loaded file. */
export function createSession(initial: PigmaFile | null = null): DocumentSession {
  let file = initial;
  let selection: string[] = [];
  return {
    getFile: () => file,
    setFile: (next) => {
      file = prepareWrite(next);
    },
    getSelection: () => [...selection],
    setSelection: (ids) => {
      selection = [...ids];
    },
  };
}

export function requireFile(session: DocumentSession): PigmaFile {
  const file = session.getFile();
  if (!file) {
    throw new McpToolError('No Pigma document is loaded. Open a document or call create_new_file first.');
  }
  return file;
}

/**
 * The revision of this call's snapshot, or `undefined` when no document is open.
 *
 * A tool that *creates* the document (`create_new_file`) uses this instead of
 * `requireSnapshot`: requiring a file would make the one tool that fixes
 * "no document is loaded" fail with that very message.
 */
export async function currentRevision(session: DocumentSession): Promise<number | undefined> {
  if (!session.getSnapshot) return undefined;
  const snapshot = await session.getSnapshot();
  return snapshot.file ? snapshot.revision : undefined;
}

/**
 * Read the document together with the revision of **this call's** snapshot, so a
 * write carries its own `expectedRevision` instead of relying on shared state.
 */
export async function requireSnapshot(
  session: DocumentSession,
): Promise<{ file: PigmaFile; revision: number | undefined }> {
  if (session.getSnapshot) {
    const snapshot = await session.getSnapshot();
    if (!snapshot.file) {
      throw new McpToolError('No Pigma document is loaded. Open a document or call create_new_file first.');
    }
    return { file: snapshot.file, revision: snapshot.revision };
  }
  return { file: requireFile(session), revision: undefined };
}

function sceneNodesUnder(node: AnyNode): SceneNode[] {
  const found: SceneNode[] = [];
  for (const child of descendants(node)) {
    if (isSceneNode(child)) found.push(child);
  }
  return found;
}

/**
 * Resolve the nodes a tool should act on, mirroring Figma's
 * "layer or current selection" semantics.
 */
export function resolveTargets(file: PigmaFile, nodeId: string | undefined, selection: string[]): SceneNode[] {
  if (nodeId) {
    const node = findNode(file.document, nodeId);
    if (!node) throw new McpToolError(unknownNodeMessage(file, nodeId));
    if (isSceneNode(node)) return [node];
    return sceneNodesUnder(node);
  }
  if (selection.length > 0) {
    const nodes: SceneNode[] = [];
    for (const id of selection) {
      const node = findNode(file.document, id);
      if (node && isSceneNode(node)) nodes.push(node);
    }
    if (nodes.length > 0) return nodes;
  }
  throw new McpToolError(
    `No layer selected. Pass \`nodeId\`, or set a selection. Available pages:\n${pageList(file)}`,
  );
}

export function pageList(file: PigmaFile): string {
  return file.document.children.map((page) => `- ${page.id} ${page.name}`).join('\n');
}

export function unknownNodeMessage(file: PigmaFile, nodeId: string): string {
  return `Unknown node id "${nodeId}". Available pages:\n${pageList(file)}`;
}
