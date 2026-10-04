/**
 * The revision guard, on every session.
 *
 * The interface declares `expectedRevision` ("the editor rejects a stale write")
 * and every write tool passes it, but only the relay path enforced it: the
 * in-memory and live-editor sessions dropped the options, so an in-process
 * server silently accepted a stale write. All paths now share `checkRevision`,
 * which throws the relay's own message.
 *
 * The relay path's behaviour is covered by tests/mcp/relay.test.ts (a stale write
 * is rejected there); these are the two paths that had none.
 */
import { describe, expect, it } from 'vitest';
import { useEditor } from '../../src/store/editorStore';
import { createEditorSession } from '../../src/mcp/bridge';
import { createSession, type DocumentSession } from '../../src/mcp/session';
import { emptyFile } from '../../src/model/validate';
import { createRectNode } from '../../src/model/factory';
import { findNode } from '../../src/model/tree';
import type { PigmaFile, SceneNode } from '../../src/model/types';

/** A one-rectangle document, plus the rectangle's id. */
function scene(): { file: PigmaFile; id: string } {
  const file = emptyFile('Revision');
  const page = file.document.children[0]!;
  const rect = createRectNode(file.document, 0, 0, 10, 10);
  page.children = [rect];
  return { file, id: rect.id };
}

const ids = (file: PigmaFile | null): string[] =>
  file ? (file.document.children[0] as { children: Array<{ id: string }> }).children.map((child) => child.id) : [];

const revisionOf = (session: DocumentSession): number => {
  const snapshot = session.getSnapshot?.() as { revision: number } | undefined;
  if (!snapshot) throw new Error('session has no getSnapshot');
  return snapshot.revision;
};

/** The two in-process sessions, built fresh for each case. */
const paths: Array<[string, () => DocumentSession]> = [
  ['in-memory', () => createSession(emptyFile('Base'))],
  [
    'editor',
    () => {
      useEditor.getState().loadFile(emptyFile('Base'));
      return createEditorSession(useEditor);
    },
  ],
];

describe('the revision guard', () => {
  for (const [name, build] of paths) {
    describe(name, () => {
      it('refuses a stale write and leaves the document untouched', () => {
        const session = build();
        const { file } = scene();
        const before = session.getFile();
        const history = name === 'editor' ? useEditor.getState().past.length : null;

        expect(() => session.setFile(file, { expectedRevision: revisionOf(session) + 1 })).toThrow(/stale revision/);
        expect(session.getFile(), `${name}: a refused write changed the document`).toBe(before);
        expect(ids(session.getFile())).toHaveLength(0);
        if (history !== null) {
          expect(useEditor.getState().past.length, `${name}: a refused write added history`).toBe(history);
        }
      });

      it('lands a write that carries the current revision', () => {
        const session = build();
        const { file } = scene();
        session.setFile(file, { expectedRevision: revisionOf(session) });
        expect(ids(session.getFile())).toHaveLength(1);
      });

      it('lands a write with no expectedRevision at all', () => {
        const session = build();
        const { file } = scene();
        session.setFile(file);
        expect(ids(session.getFile())).toHaveLength(1);
      });

      it('counts a write as a revision, so a re-used revision is stale', () => {
        const session = build();
        const { file } = scene();
        const revision = revisionOf(session);
        session.setFile(file, { expectedRevision: revision });
        expect(revisionOf(session)).toBe(revision + 1);
        expect(() => session.setFile(file, { expectedRevision: revision })).toThrow(/stale revision/);
      });

      it('guards setSelection the same way', () => {
        const session = build();
        const { file, id } = scene();
        session.setFile(file);
        const revision = revisionOf(session);
        session.setSelection([id], { expectedRevision: revision });
        expect(session.getSelection()).toEqual([id]);
        expect(() => session.setSelection([], { expectedRevision: revision })).toThrow(/stale revision/);
      });

      it('never reports a selected id that the document no longer has', () => {
        const session = build();
        const { file, id } = scene();
        session.setFile(file);
        session.setSelection([id]);
        expect(session.getSelection()).toEqual([id]);

        // A write that deletes the selected node.
        const page = file.document.children[0]!;
        const emptied = {
          ...file,
          document: { ...file.document, children: [{ ...page, children: [] }, ...file.document.children.slice(1)] },
        } as PigmaFile;
        session.setFile(emptied);

        expect(ids(session.getFile())).toHaveLength(0);
        expect(session.getSelection(), `${name}: the selection kept a deleted id`).toEqual([]);
        if (name === 'editor') {
          expect(useEditor.getState().selection, `${name}: the editor's own selection kept a deleted id`).toEqual([]);
        }
      });

      it('keeps a selected id that still exists', () => {
        const session = build();
        const { file, id } = scene();
        session.setFile(file);
        session.setSelection([id]);
        // A write that changes the node but does not remove it.
        const page = file.document.children[0] as { children: SceneNode[] };
        const renamed = {
          ...file,
          document: {
            ...file.document,
            children: [
              { ...page, children: page.children.map((child) => ({ ...child, name: 'Renamed' })) },
              ...file.document.children.slice(1),
            ],
          },
        } as PigmaFile;
        session.setFile(renamed);
        expect(session.getSelection()).toEqual([id]);
        expect(findNode(session.getFile()!.document, id)?.name).toBe('Renamed');
      });
    });
  }

  it('throws the same message the relay path throws', () => {
    const session = createSession(emptyFile('Base'));
    let message = '';
    try {
      session.setFile(scene().file, { expectedRevision: 7 });
    } catch (error) {
      message = (error as Error).message;
    }
    // The relay client's wording, from one shared implementation.
    expect(message).toMatch(/^stale revision: editor is at 0, caller read 7 \(local changes happened in between\)$/);
  });
});
