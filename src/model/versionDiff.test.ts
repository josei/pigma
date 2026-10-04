import { describe, expect, it } from 'vitest';
import { diffDocuments, diffSummary, isUnchanged } from './versionDiff';
import { createRectNode, createTextNode } from './factory';
import { emptyFile } from './validate';
import { findNode, updateNode } from './tree';
import type { PigmaFile, SceneNode, TextStyle } from './types';

/** A document with two rectangles, one of them named. */
function scene(): { file: PigmaFile; first: string; second: string } {
  const file = emptyFile('Compare');
  const page = file.document.children[0]!;
  const a = createRectNode(file.document, 0, 0, 100, 100);
  const b = createRectNode(file.document, 200, 0, 100, 100);
  b.name = 'Second';
  page.children = [a, b];
  return { file, first: a.id, second: b.id };
}

const withNode = (file: PigmaFile, node: SceneNode): PigmaFile => ({
  ...file,
  document: updateNode(file.document, file.document.children[0]!.id, (page) => ({
    ...page,
    children: [...(page as { children: SceneNode[] }).children, node],
  }) as SceneNode),
});

describe('version compare', () => {
  it('reports no changes for an identical document', () => {
    const { file } = scene();
    const diff = diffDocuments(file, file);
    expect(isUnchanged(diff)).toBe(true);
    expect(diff).toMatchObject({ added: [], removed: [], changed: [] });
    expect(diffSummary(diff)).toBe('No changes');
  });

  it('reports a moved layer as CHANGED with the position property', () => {
    const { file, first } = scene();
    const moved = { ...file, document: updateNode(file.document, first, (node) => ({ ...node, transform: { ...node.transform, tx: 40, ty: 25 } })) };
    const diff = diffDocuments(file, moved);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0]).toMatchObject({ id: first, properties: ['position'] });
  });

  it('names the property for each kind of change', () => {
    const { file, first } = scene();
    const cases: Array<[string, (node: SceneNode) => SceneNode]> = [
      ['size', (node) => ({ ...node, width: 150 })],
      ['name', (node) => ({ ...node, name: 'Renamed' })],
      ['opacity', (node) => ({ ...node, opacity: 0.5 })],
      ['visible', (node) => ({ ...node, visible: false })],
      ['fill', (node) => ({ ...node, fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1 } as never] })],
      ['corner radius', (node) => ({ ...node, cornerRadius: 12 })],
    ];
    for (const [property, mutate] of cases) {
      const after = {
        ...file,
        document: updateNode(file.document, first, (node) => mutate(node as SceneNode) as never),
      };
      const diff = diffDocuments(file, after);
      expect(diff.changed[0]?.properties, property).toContain(property);
    }
  });

  it('reports added and removed layers by id', () => {
    const { file, second } = scene();
    const added = withNode(file, createRectNode(file.document, 400, 0, 50, 50));
    const withAddition = diffDocuments(file, added);
    expect(withAddition.added).toHaveLength(1);
    expect(withAddition.removed).toEqual([]);
    expect(withAddition.changed).toEqual([]);

    const removedPage = updateNode(file.document, file.document.children[0]!.id, (page) => ({
      ...page,
      children: (page as { children: SceneNode[] }).children.filter((child) => child.id !== second),
    }) as SceneNode);
    const withRemoval = diffDocuments(file, { ...file, document: removedPage });
    expect(withRemoval.removed).toEqual([second]);
    expect(withRemoval.added).toEqual([]);
  });

  it('reports text and font changes on a text layer', () => {
    const file = emptyFile('Text');
    const page = file.document.children[0]!;
    const label = createTextNode(file.document, 0, 0, 'Hello', { fontSize: 14 });
    page.children = [label];

    const retyped = { ...file, document: updateNode(file.document, label.id, (node) => ({ ...node, characters: 'Goodbye' })) };
    expect(diffDocuments(file, retyped).changed[0]!.properties).toEqual(['text']);

    const restyled = {
      ...file,
      document: updateNode(file.document, label.id, (node) => ({
        ...node,
        style: { ...(node as { style: TextStyle }).style, fontSize: 24 },
      })),
    };
    expect(diffDocuments(file, restyled).changed[0]!.properties).toEqual(['font']);
  });

  it('is deterministic and id-keyed, not order-keyed', () => {
    const { file, first, second } = scene();
    // Reordering the page must not look like an add plus a remove.
    const page = file.document.children[0]!;
    const reordered = {
      ...file,
      document: updateNode(file.document, page.id, (target) => ({
        ...target,
        children: [...(target as { children: SceneNode[] }).children].reverse(),
      }) as SceneNode),
    };
    const diff = diffDocuments(file, reordered);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    // The ids are reported in the new document's order.
    expect(diffDocuments(file, reordered)).toEqual(diff);
    expect(findNode(reordered.document, first)).toBeTruthy();
    expect(findNode(reordered.document, second)).toBeTruthy();
  });

  it('never mutates either document', () => {
    const { file, first } = scene();
    const before = JSON.stringify(file);
    const moved = { ...file, document: updateNode(file.document, first, (node) => ({ ...node, transform: { ...node.transform, tx: 10, ty: 10 } })) };
    const after = JSON.stringify(moved);
    diffDocuments(file, moved);
    expect(JSON.stringify(file)).toBe(before);
    expect(JSON.stringify(moved)).toBe(after);
  });
});
