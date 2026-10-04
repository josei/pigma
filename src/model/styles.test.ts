import { describe, expect, it } from 'vitest';
import {
  applyStyle,
  collectBoundNodes,
  createStyleFromNode,
  deleteStyle,
  detachStyle,
  renameStyle,
  styleBindingOf,
  styleSummary,
  stylesOf,
  updateStylePayload,
} from './styles';
import { createRectNode, createTextNode } from './factory';
import { emptyFile } from './validate';
import { findNode } from './tree';
import { parseFile, serializeFile } from './serialize';
import type { SceneNode } from './types';

function setup() {
  const file = emptyFile('Styles');
  const page = file.document.children[0]!;
  const rect = createRectNode(null, 0, 0, 100, 100);
  rect.fills = [{ type: 'SOLID', color: { r: 0.1, g: 0.4, b: 0.9 }, opacity: 1 }];
  rect.effects = [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.2 }, offset: { x: 0, y: 2 }, radius: 6, visible: true }];
  const text = createTextNode(null, 0, 0, 'Hello');
  const other = createRectNode(null, 200, 0, 50, 50);
  page.children = [rect, text, other];
  return { file, pageId: page.id, rectId: rect.id, textId: text.id, otherId: other.id };
}

const fillsOf = (file: ReturnType<typeof setup>['file'], id: string) =>
  (findNode(file.document, id) as SceneNode).fills;

describe('styles', () => {
  it('creates a fill style from a node and binds it', () => {
    const { file, rectId } = setup();
    const { file: created, styleId } = createStyleFromNode(file, rectId, 'FILL', 'Brand blue');
    expect(styleId).toBeTruthy();
    const definition = stylesOf(created)[styleId!]!;
    expect(definition.name).toBe('Brand blue');
    expect(definition.type).toBe('FILL');
    expect(definition.paints?.[0]).toMatchObject({ type: 'SOLID' });
    expect(styleBindingOf(findNode(created.document, rectId) as SceneNode).fill).toBe(styleId);
  });

  it('creates text and effect styles only from suitable nodes', () => {
    const { file, rectId, textId } = setup();
    const text = createStyleFromNode(file, textId, 'TEXT');
    expect(text.styleId).toBeTruthy();
    const effect = createStyleFromNode(file, rectId, 'EFFECT');
    expect(effect.styleId).toBeTruthy();
    // A rectangle cannot carry a text style.
    expect(createStyleFromNode(file, rectId, 'TEXT').styleId).toBeNull();
    // A node with no fills cannot carry a fill style.
    const bare = { ...file, document: { ...file.document, children: file.document.children.map((page) => ({ ...page, children: page.children.map((child) => (child.id === rectId ? { ...child, fills: [], effects: [] } : child)) })) } };
    expect(createStyleFromNode(bare, rectId, 'FILL').styleId).toBeNull();
  });

  it('applies a style to other nodes and detaches it', () => {
    const { file, rectId, otherId } = setup();
    const { file: created, styleId } = createStyleFromNode(file, rectId, 'FILL', 'Brand blue');
    const applied = applyStyle(created, styleId!, [otherId]);
    expect(fillsOf(applied, otherId)[0]).toMatchObject({ type: 'SOLID' });
    expect(styleBindingOf(findNode(applied.document, otherId) as SceneNode).fill).toBe(styleId);
    expect(collectBoundNodes(applied, styleId!).sort()).toEqual([otherId, rectId].sort());

    const detached = detachStyle(applied, [otherId]);
    expect(styleBindingOf(findNode(detached.document, otherId) as SceneNode).fill).toBeUndefined();
    // Detaching keeps the painted values.
    expect(fillsOf(detached, otherId)).toHaveLength(1);
  });

  it('propagates an edited payload to every bound node', () => {
    const { file, rectId, otherId } = setup();
    const { file: created, styleId } = createStyleFromNode(file, rectId, 'FILL', 'Brand blue');
    const applied = applyStyle(created, styleId!, [otherId]);

    // Recolour the source node, then push it into the style.
    const recoloured: typeof applied = {
      ...applied,
      document: {
        ...applied.document,
        children: applied.document.children.map((page) => ({
          ...page,
          children: page.children.map((child) =>
            child.id === rectId ? ({ ...child, fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1 }] } as SceneNode) : child,
          ),
        })),
      },
    };
    const updated = updateStylePayload(recoloured, styleId!, rectId);
    expect(fillsOf(updated, otherId)[0]).toMatchObject({ color: { r: 1, g: 0, b: 0 } });
  });

  it('renames and deletes styles, cleaning up bindings', () => {
    const { file, rectId, otherId } = setup();
    const { file: created, styleId } = createStyleFromNode(file, rectId, 'FILL', 'Brand blue');
    const applied = applyStyle(created, styleId!, [otherId]);

    const renamed = renameStyle(applied, styleId!, 'Primary');
    expect(stylesOf(renamed)[styleId!]!.name).toBe('Primary');
    expect(renameStyle(renamed, styleId!, '   ').styles).toBe(renamed.styles);

    const deleted = deleteStyle(renamed, styleId!);
    expect(stylesOf(deleted)[styleId!]).toBeUndefined();
    expect(styleBindingOf(findNode(deleted.document, otherId) as SceneNode).fill).toBeUndefined();
    expect(fillsOf(deleted, otherId)).toHaveLength(1);
  });

  it('describes a style for the panel', () => {
    const { file, rectId } = setup();
    const { file: created, styleId } = createStyleFromNode(file, rectId, 'FILL');
    expect(styleSummary(stylesOf(created)[styleId!]!)).toBe('Solid fill');
  });

  it('round-trips the styles table and bindings through JSON', () => {
    const { file, rectId, otherId } = setup();
    const { file: created, styleId } = createStyleFromNode(file, rectId, 'EFFECT', 'Card shadow');
    const applied = applyStyle(created, styleId!, [otherId]);
    const restored = parseFile(serializeFile(applied));
    expect(restored.ok).toBe(true);
    expect(stylesOf(restored.file!)[styleId!]).toMatchObject({ name: 'Card shadow', type: 'EFFECT' });
    expect(styleBindingOf(findNode(restored.file!.document, otherId) as SceneNode).effect).toBe(styleId);
  });
});
