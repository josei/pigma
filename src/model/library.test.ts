import { describe, expect, it } from 'vitest';
import {
  componentKey,
  importLibraryStyle,
  importLibraryVariables,
  instantiateFromLibrary,
  libraryComponent,
  libraryLinkForComponent,
  libraryLinkOf,
  publishLibrary,
  staleLibraryInstances,
  updateInstancesFromLibrary,
  upsertLibrary,
  type Library,
} from './library';
import { createFrameNode, createRectNode } from './factory';
import { emptyFile } from './validate';
import { parseFile, serializeFile } from './serialize';
import { findNode, updateNode } from './tree';
import type { ComponentNode, InstanceNode, PigmaFile, SceneNode } from './types';

const COMPONENT_ID = 'comp:1';
const CHILD_ID = 'child:1';

/** A source file with one component (and one nested child), one style and one variable. */
function sourceFile(): PigmaFile {
  const file = emptyFile('Source');
  const page = file.document.children[0]!;
  const child: SceneNode = { ...createRectNode(null, 8, 8, 32, 32), id: CHILD_ID, name: 'Label' };
  const component = {
    ...createFrameNode(null, 0, 0, 120, 64),
    id: COMPONENT_ID,
    name: 'Card',
    type: 'COMPONENT',
    description: 'A card component',
    children: [child],
  } as SceneNode;
  page.children = [component];
  file.styles = {
    'S:1': {
      key: 'S:1',
      name: 'Brand/Fill',
      type: 'FILL',
      description: 'brand',
      paints: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }],
    },
  };
  file.variableCollections = {
    'C:1': { id: 'C:1', name: 'Theme', modes: [{ modeId: 'M:1', name: 'Mode 1' }], defaultModeId: 'M:1', variableIds: ['V:1'] },
  };
  file.variables = {
    'V:1': {
      id: 'V:1',
      name: 'Primary',
      resolvedType: 'COLOR',
      variableCollectionId: 'C:1',
      valuesByMode: { 'M:1': { r: 1, g: 0, b: 0, a: 1 } },
    },
  };
  return file;
}

function makeInstance(id: string, libraryId: string, key: string, version: number, tx = 0, ty = 0): InstanceNode {
  return {
    id,
    name: 'Card',
    type: 'INSTANCE',
    visible: true,
    locked: false,
    opacity: 1,
    transform: { a: 1, b: 0, c: 0, d: 1, tx, ty },
    width: 120,
    height: 64,
    fills: [],
    strokes: [],
    children: [],
    componentId: 'local:1',
    libraryId,
    libraryKey: key,
    libraryVersion: version,
  };
}

describe('publishLibrary', () => {
  it('captures components (with nested children), styles and variables', () => {
    const file = sourceFile();
    const { library, file: published } = publishLibrary(file);

    expect(library.components).toHaveLength(1);
    const entry = library.components[0]!;
    expect(entry.name).toBe('Card');
    expect(entry.width).toBe(120);
    expect(entry.height).toBe(64);
    expect(entry.description).toBe('A card component');
    expect(entry.key).toBe(componentKey(findNode(file.document, COMPONENT_ID) as SceneNode));

    const node = entry.node as ComponentNode;
    expect(node.id).toBe(COMPONENT_ID);
    expect(node.children).toHaveLength(1);
    expect(node.children[0]!.id).toBe(CHILD_ID);
    expect(node.children[0]!.name).toBe('Label');

    expect(library.styles).toEqual([
      {
        key: 'S:1',
        name: 'Brand/Fill',
        type: 'FILL',
        description: 'brand',
        payload: { paints: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }] },
      },
    ]);
    expect(Object.keys(library.variables)).toEqual(['V:1']);
    expect(Object.keys(library.variableCollections)).toEqual(['C:1']);
    expect(library.sourceFileId).toBe(file.document.id);
    expect(library.sourceFileName).toBe('Source');
    expect(library.version).toBe(1);
    expect(published.publishedLibrary).toEqual({
      id: library.id,
      name: library.name,
      version: 1,
      publishedAt: library.publishedAt,
    });
  });

  it('keeps the library independent from later edits to the source file', () => {
    const file = sourceFile();
    const { library } = publishLibrary(file);
    const sourceComponent = findNode(file.document, COMPONENT_ID) as ComponentNode;
    sourceComponent.name = 'Edited';
    (sourceComponent.children[0] as SceneNode).name = 'Edited child';

    expect(library.components[0]!.name).toBe('Card');
    expect((library.components[0]!.node as ComponentNode).children[0]!.name).toBe('Label');
  });

  it('increments version and preserves the id on re-publish', () => {
    const file = sourceFile();
    const first = publishLibrary(file);
    const second = publishLibrary(first.file, { name: 'Source v2' });
    expect(second.library.id).toBe(first.library.id);
    expect(second.library.version).toBe(2);
    expect(second.library.name).toBe('Source v2');
    expect(second.file.publishedLibrary?.version).toBe(2);

    const forced = publishLibrary(first.file, { libraryId: first.library.id, version: 9 });
    expect(forced.library.id).toBe(first.library.id);
    expect(forced.library.version).toBe(9);

    const other = publishLibrary(first.file, { libraryId: 'lib:other' });
    expect(other.library.id).toBe('lib:other');
    expect(other.library.version).toBe(1);
  });
});

describe('componentKey', () => {
  it('is deterministic and prefers an explicit key', () => {
    const node = findNode(sourceFile().document, COMPONENT_ID) as SceneNode;
    expect(componentKey(node)).toBe(componentKey(node));
    expect(componentKey({ ...node, raw: { key: 'explicit-key' } })).toBe('explicit-key');
    expect(componentKey({ ...node, name: 'Other' })).not.toBe(componentKey(node));
  });
});

describe('upsertLibrary', () => {
  it('replaces by id and keeps the newest last', () => {
    const { library } = publishLibrary(sourceFile());
    const a: Library = { ...library, id: 'a', name: 'A' };
    const b: Library = { ...library, id: 'b', name: 'B' };
    const list = upsertLibrary([a, b], { ...a, name: 'A2' });
    expect(list.map((entry) => entry.id)).toEqual(['b', 'a']);
    expect(list[1]!.name).toBe('A2');
    expect(upsertLibrary([], b).map((entry) => entry.id)).toEqual(['b']);
  });
});

describe('libraryComponent', () => {
  it('finds an entry by key and returns null otherwise', () => {
    const { library } = publishLibrary(sourceFile());
    const key = library.components[0]!.key;
    expect(libraryComponent(library, key)).toBe(library.components[0]);
    expect(libraryComponent(library, 'missing')).toBeNull();
  });
});

describe('instantiateFromLibrary', () => {
  it('materialises a component and a linked instance', () => {
    const { library } = publishLibrary(sourceFile());
    const target = emptyFile('Target');
    const pageId = target.document.children[0]!.id;
    const key = library.components[0]!.key;

    const result = instantiateFromLibrary(target, library, key, { parentId: pageId, x: 40, y: 60 });
    expect(result.instanceId).toBeTruthy();
    expect(result.componentId).toBeTruthy();
    expect(result.instanceId).not.toBe(result.componentId);

    const instance = findNode(result.file.document, result.instanceId!) as InstanceNode;
    expect(instance.type).toBe('INSTANCE');
    expect(instance.libraryId).toBe(library.id);
    expect(instance.libraryKey).toBe(key);
    expect(instance.libraryVersion).toBe(library.version);
    expect(instance.transform.tx).toBe(40);
    expect(instance.transform.ty).toBe(60);
    expect(instance.width).toBe(120);
    expect(instance.height).toBe(64);
    expect(instance.children).toHaveLength(1);
    expect(instance.children[0]!.name).toBe('Label');

    const local = findNode(result.file.document, result.componentId!) as ComponentNode;
    expect(local.type).toBe('COMPONENT');
    expect(local.children).toHaveLength(1);
    expect(local.id).not.toBe(library.components[0]!.node.id);
    expect(instance.children[0]!.id).not.toBe((library.components[0]!.node as ComponentNode).children[0]!.id);
  });

  it('shares no mutable state with the library entry', () => {
    const { library } = publishLibrary(sourceFile());
    const target = emptyFile('Target');
    const pageId = target.document.children[0]!.id;
    const entry = library.components[0]!;
    const result = instantiateFromLibrary(target, library, entry.key, { parentId: pageId, x: 0, y: 0 });
    const instance = findNode(result.file.document, result.instanceId!) as InstanceNode;
    const entryChild = (entry.node as ComponentNode).children[0]!;
    const instanceChild = instance.children[0]!;

    entryChild.name = 'LibraryEdit';
    entry.node.width = 999;
    expect(instance.children[0]!.name).toBe('Label');
    expect(instance.width).toBe(120);

    instanceChild.name = 'FileEdit';
    expect(entryChild.name).toBe('LibraryEdit');
    expect((entry.node as ComponentNode).children[0]!.name).toBe('LibraryEdit');
  });

  it('returns nulls and an unchanged file when the library, key or parent is missing', () => {
    const { library } = publishLibrary(sourceFile());
    const target = emptyFile('Target');
    const pageId = target.document.children[0]!.id;
    const key = library.components[0]!.key;

    const badKey = instantiateFromLibrary(target, library, 'missing', { parentId: pageId, x: 0, y: 0 });
    expect(badKey.file).toBe(target);
    expect(badKey.instanceId).toBeNull();
    expect(badKey.componentId).toBeNull();

    const badParent = instantiateFromLibrary(target, library, key, { parentId: 'missing', x: 0, y: 0 });
    expect(badParent.file).toBe(target);
    expect(badParent.instanceId).toBeNull();
    expect(badParent.componentId).toBeNull();

    const empty: Library = { ...library, components: [] };
    const badLibrary = instantiateFromLibrary(target, empty, key, { parentId: pageId, x: 0, y: 0 });
    expect(badLibrary.file).toBe(target);
    expect(badLibrary.instanceId).toBeNull();
    expect(badLibrary.componentId).toBeNull();
  });
});

describe('libraryLinkOf', () => {
  it('returns null for a plain node and the link for a linked instance', () => {
    expect(libraryLinkOf(createRectNode(null, 0, 0, 10, 10))).toBeNull();
    const instance = makeInstance('i:1', 'lib:1', 'k', 3);
    expect(libraryLinkOf(instance)).toEqual({ libraryId: 'lib:1', libraryKey: 'k', libraryVersion: 3 });
    expect(libraryLinkOf({ ...instance, libraryVersion: undefined })).toBeNull();
    expect(libraryLinkOf({ ...instance, libraryKey: undefined })).toBeNull();
  });
});

describe('staleLibraryInstances', () => {
  it('reports only instances behind the library version', () => {
    const first = publishLibrary(sourceFile());
    const library: Library = { ...first.library, version: first.library.version + 1 };
    const key = library.components[0]!.key;
    const file = emptyFile('Stale');
    file.document.children[0]!.children = [
      makeInstance('old', library.id, key, 1),
      makeInstance('current', library.id, key, library.version, 200, 0),
      makeInstance('unknown', 'lib:missing', key, 1),
    ];

    const stale = staleLibraryInstances(file, [library]);
    expect(stale).toEqual([
      {
        instanceId: 'old',
        name: 'Card',
        libraryId: library.id,
        libraryKey: key,
        publishedVersion: 1,
        currentVersion: library.version,
      },
    ]);
  });
});

describe('updateInstancesFromLibrary', () => {
  it('refreshes geometry and children while keeping id, position, name and overrides', () => {
    const { library } = publishLibrary(sourceFile());
    const target = emptyFile('Target');
    const pageId = target.document.children[0]!.id;
    const key = library.components[0]!.key;
    const inserted = instantiateFromLibrary(target, library, key, { parentId: pageId, x: 10, y: 20 });
    const withOverrides: PigmaFile = {
      ...inserted.file,
      document: updateNode(inserted.file.document, inserted.instanceId!, (node) => ({
        ...(node as InstanceNode),
        name: 'Renamed',
        overrides: { [CHILD_ID]: { name: 'Overridden' } },
      })),
    };

    const evolved: Library = {
      ...library,
      version: library.version + 1,
      components: library.components.map((entry) => {
        const node = structuredClone(entry.node) as ComponentNode;
        node.width = 200;
        node.height = 80;
        node.children = [
          ...node.children,
          { ...createRectNode(null, 0, 0, 10, 10), id: 'extra:1', name: 'Extra' } as SceneNode,
        ];
        return { ...entry, node, width: 200, height: 80 };
      }),
    };

    const result = updateInstancesFromLibrary(withOverrides, evolved);
    expect(result.updated).toBe(1);

    const instance = findNode(result.file.document, inserted.instanceId!) as InstanceNode;
    expect(instance.id).toBe(inserted.instanceId);
    expect(instance.name).toBe('Renamed');
    expect(instance.transform.tx).toBe(10);
    expect(instance.transform.ty).toBe(20);
    expect(instance.width).toBe(200);
    expect(instance.height).toBe(80);
    expect(instance.libraryVersion).toBe(2);
    expect(instance.overrides).toEqual({ [CHILD_ID]: { name: 'Overridden' } });
    expect(instance.children.map((child) => child.name).sort()).toEqual(['Extra', 'Overridden']);
  });

  it('adopts the published shape, not just the geometry', () => {
    const { library } = publishLibrary(sourceFile());
    const target = emptyFile('Target');
    const pageId = target.document.children[0]!.id;
    const inserted = instantiateFromLibrary(target, library, library.components[0]!.key, {
      parentId: pageId,
      x: 0,
      y: 0,
    });
    const evolved: Library = {
      ...library,
      version: 2,
      components: library.components.map((entry) => {
        const node = structuredClone(entry.node) as ComponentNode;
        node.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1 }];
        node.cornerRadius = 12;
        return { ...entry, node };
      }),
    };
    const result = updateInstancesFromLibrary(inserted.file, evolved);
    const instance = findNode(result.file.document, inserted.instanceId!) as InstanceNode;
    // A rectangle instance *is* the rectangle: its fill and radius come from the
    // master, which is what "adopts v2" means to the user.
    expect(instance.fills).toEqual([{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1 }]);
    expect(instance.cornerRadius).toBe(12);
    expect(instance.libraryVersion).toBe(2);
  });

  it('updates a single instance when asked for one', () => {
    const { library } = publishLibrary(sourceFile());
    const target = emptyFile('Target');
    const pageId = target.document.children[0]!.id;
    const key = library.components[0]!.key;
    const first = instantiateFromLibrary(target, library, key, { parentId: pageId, x: 0, y: 0 });
    const second = instantiateFromLibrary(first.file, library, key, { parentId: pageId, x: 80, y: 0 });
    const evolved: Library = { ...library, version: 2 };
    const result = updateInstancesFromLibrary(second.file, evolved, { instanceId: second.instanceId! });
    expect(result.updated).toBe(1);
    expect((findNode(result.file.document, second.instanceId!) as InstanceNode).libraryVersion).toBe(2);
    // The other instance is untouched.
    expect((findNode(result.file.document, first.instanceId!) as InstanceNode).libraryVersion).toBe(1);
  });

  it('reports zero when no instance links to the library', () => {
    const { library } = publishLibrary(sourceFile());
    const empty = emptyFile('Empty');
    const result = updateInstancesFromLibrary(empty, library);
    expect(result.updated).toBe(0);
    expect(result.file).toBe(empty);
  });
});

describe('libraryLinkForComponent', () => {
  it('finds the link an instance of a published component should carry', () => {
    const { library } = publishLibrary(sourceFile());
    const key = library.components[0]!.key;
    expect(libraryLinkForComponent([library], COMPONENT_ID)).toEqual({
      libraryId: library.id,
      libraryKey: key,
      libraryVersion: library.version,
    });
    // An unpublished component has no link, and the newest publication wins.
    expect(libraryLinkForComponent([library], 'not-published')).toBeNull();
    const newer: Library = { ...library, id: 'lib:2', version: library.version + 3 };
    expect(libraryLinkForComponent([library, newer], COMPONENT_ID)).toMatchObject({
      libraryId: 'lib:2',
      libraryVersion: library.version + 3,
    });
  });
});

describe('importing published styles and variables', () => {
  it('copies a published style with its payload, once', () => {
    const { library } = publishLibrary(sourceFile());
    expect(library.styles[0]!.payload?.paints).toEqual([{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }]);

    const target = emptyFile('Target');
    const first = importLibraryStyle(target, library, 'S:1');
    expect(first.styleId).toBeTruthy();
    const definition = first.file.styles![first.styleId!]!;
    expect(definition).toMatchObject({ key: 'S:1', name: 'Brand/Fill', type: 'FILL', description: 'brand' });
    expect(definition.paints).toEqual([{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }]);

    // Importing again reuses the local style instead of duplicating it.
    const second = importLibraryStyle(first.file, library, 'S:1');
    expect(second.styleId).toBe(first.styleId);
    expect(Object.keys(second.file.styles!)).toHaveLength(1);

    // Unknown key leaves the file untouched.
    expect(importLibraryStyle(target, library, 'nope')).toEqual({ file: target, styleId: null });
  });

  it('copies variables with remapped ids and keeps them bindable', () => {
    const { library } = publishLibrary(sourceFile());
    const target = emptyFile('Target');
    const result = importLibraryVariables(target, library);
    expect(result.imported).toBe(1);

    const collections = Object.values(result.file.variableCollections!);
    expect(collections).toHaveLength(1);
    const collection = collections[0]!;
    expect(collection.name).toBe('Theme');
    // Fresh ids, remapped values and an active mode pointing at the local mode.
    expect(collection.id).not.toBe('C:1');
    expect(collection.modes[0]!.modeId).not.toBe('M:1');
    expect(result.file.activeModes![collection.id]).toBe(collection.modes[0]!.modeId);

    const variable = Object.values(result.file.variables!)[0]!;
    expect(variable.name).toBe('Primary');
    expect(variable.id).not.toBe('V:1');
    expect(variable.variableCollectionId).toBe(collection.id);
    expect(variable.valuesByMode[collection.modes[0]!.modeId]).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect(collection.variableIds).toEqual([variable.id]);

    // Idempotent: a second import neither duplicates nor renumbers.
    const again = importLibraryVariables(result.file, library);
    expect(again.imported).toBe(0);
    expect(Object.keys(again.file.variables!)).toHaveLength(1);
    expect(Object.keys(again.file.variableCollections!)).toHaveLength(1);
  });

  it('leaves a file untouched when the library has no variables', () => {
    const file = emptyFile('Source');
    const { library } = publishLibrary(file);
    const target = emptyFile('Target');
    expect(importLibraryVariables(target, library)).toEqual({ file: target, imported: 0 });
  });
});

describe('library links survive serialization', () => {
  it('keeps the instance link and the publication record through JSON', () => {
    const { library, file } = publishLibrary(sourceFile());
    const inserted = instantiateFromLibrary(file, library, library.components[0]!.key, {
      parentId: file.document.children[0]!.id,
      x: 0,
      y: 0,
    });
    expect(inserted.instanceId).toBeTruthy();

    const restored = parseFile(serializeFile(inserted.file));
    expect(restored.ok).toBe(true);
    const instance = findNode(restored.file!.document, inserted.instanceId!) as InstanceNode;
    expect(instance.type).toBe('INSTANCE');
    expect(instance.libraryId).toBe(library.id);
    expect(instance.libraryKey).toBe(library.components[0]!.key);
    expect(instance.libraryVersion).toBe(library.version);
    expect(restored.file!.publishedLibrary).toMatchObject({ id: library.id, version: library.version });
    // Staleness is still computable after a reload.
    const republished = { ...library, version: library.version + 1 };
    expect(staleLibraryInstances(restored.file!, [republished])).toHaveLength(1);
  });
});
