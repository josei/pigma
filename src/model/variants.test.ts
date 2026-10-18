import { describe, expect, it } from 'vitest';
import {
  addComponentProperty,
  componentKey,
  componentLibrary,
  componentSetOf,
  createComponentSet,
  describeVariant,
  makeSlot,
  findVariant,
  formatVariantName,
  parseVariantName,
  removeComponentProperty,
  resolvedProperties,
  resolvePropertyReferences,
  setInstanceProperty,
  setInstanceVariant,
  setPropertyReference,
  suggestedComponents,
  variantOptions,
} from './variants';
import { createFrameNode, createRectNode, createTextNode } from './factory';
import { emptyFile } from './validate';
import { findNode } from './tree';
import { parseFile, serializeFile } from './serialize';
import { syncInstances } from './instances';
import type { ComponentNode, InstanceNode, SceneNode } from './types';

/** Two real COMPONENT nodes named like Figma variants. */
function setup() {
  const file = emptyFile('Variants');
  const page = file.document.children[0]!;
  const component = (name: string, x: number, size: number): SceneNode => {
    const rect = createRectNode(null, x, 0, size, size);
    return {
      ...rect,
      name,
      type: 'COMPONENT',
      clipsContent: true,
      children: [{ ...createTextNode(null, 8, 8, name), id: `${rect.id}:label` }],
    } as SceneNode;
  };
  const small = component('Size=Small', 0, 100);
  const large = component('Size=Large', 200, 200);
  page.children = [small, large];
  return { file, pageId: page.id, smallId: small.id, largeId: large.id };
}

const componentOf = (file: ReturnType<typeof setup>['file'], id: string) => findNode(file.document, id) as ComponentNode;

describe('variants and component properties', () => {
  it('parses and formats variant names', () => {
    expect(parseVariantName('Size=Large, State=Hover')).toEqual({ Size: 'Large', State: 'Hover' });
    expect(parseVariantName('Plain')).toEqual({});
    expect(formatVariantName({ State: 'Hover', Size: 'Large' }, ['Size', 'State'])).toBe('Size=Large, State=Hover');
  });

  it('wraps components into a set with a VARIANT property', () => {
    const { file, smallId, largeId } = setup();
    const small = createComponentSet(file, [smallId], 'x');
    expect(small.setId).toBeNull();

    const result = createComponentSet(file, [smallId, largeId], 'Button');
    expect(result.setId).toBeTruthy();
    const set = componentOf(result.file, result.setId!);
    expect(set.type).toBe('COMPONENT_SET');
    expect(set.children).toHaveLength(2);
    expect(set.componentPropertyDefinitions).toMatchObject({ Size: { type: 'VARIANT', variantOptions: ['Small', 'Large'] } });
    expect(variantOptions(set)).toEqual({ Size: ['Small', 'Large'] });
    expect(componentSetOf(result.file, smallId)?.id).toBe(result.setId);
    expect(findVariant(set, { Size: 'Large' })?.id).toBe(largeId);
    expect(describeVariant(componentOf(result.file, largeId))).toBe('Size: Large');
  });

  it('switches an instance between variants and re-syncs its children', () => {
    const { file, smallId, largeId } = setup();
    const { file: withSet, setId } = createComponentSet(file, [smallId, largeId]);
    const page = withSet.document.children[0]!;
    const instance: InstanceNode = {
      id: 'inst:1',
      name: 'Button',
      type: 'INSTANCE',
      visible: true,
      locked: false,
      opacity: 1,
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 600, ty: 0 },
      width: 100,
      height: 100,
      fills: [],
      strokes: [],
      children: [],
      componentId: smallId,
    };
    page.children = [...page.children, instance];
    const synced = { ...withSet, document: syncInstances(withSet.document) };
    expect(findNode(synced.document, 'inst:1')).toBeTruthy();

    const switched = setInstanceVariant(synced, 'inst:1', 'Size', 'Large');
    const after = findNode(switched.document, 'inst:1') as InstanceNode;
    expect(after.componentId).toBe(largeId);
    expect(after.componentProperties).toMatchObject({ Size: 'Large' });
    expect(after.children).toHaveLength(1);
    expect(resolvedProperties(switched, after)).toMatchObject({ Size: 'Large' });
    expect(findNode(switched.document, setId!)).toBeTruthy();

    // An unknown variant value is refused rather than half-applied.
    expect(setInstanceVariant(switched, 'inst:1', 'Size', 'Huge').document).toBe(switched.document);
  });

  it('adds BOOLEAN / TEXT properties and resolves their references on layers', () => {
    const { file, smallId } = setup();
    const page = file.document.children[0]!;
    const component = findNode(file.document, smallId) as SceneNode;
    const label = createTextNode(null, 10, 10, 'Label');
    (component as { children: SceneNode[] }).children = [label];

    let next = addComponentProperty(file, smallId, 'BOOLEAN', 'Show label', true);
    next = addComponentProperty(next, smallId, 'TEXT', 'Label text', 'Hi');
    const definitions = componentOf(next, smallId).componentPropertyDefinitions!;
    expect(definitions.Show).toBeUndefined();
    expect(definitions['Show label']).toMatchObject({ type: 'BOOLEAN', defaultValue: true });
    expect(definitions['Label text']).toMatchObject({ type: 'TEXT', defaultValue: 'Hi' });

    next = setPropertyReference(next, label.id, 'visible', 'Show label');
    next = setPropertyReference(next, label.id, 'characters', 'Label text');
    const bound = findNode(next.document, label.id) as SceneNode;
    expect(bound.componentPropertyReferences).toEqual({ visible: 'Show label', characters: 'Label text' });
    expect(resolvePropertyReferences(bound, { 'Show label': false, 'Label text': 'Bye' })).toEqual({ visible: false, characters: 'Bye' });

    // Removing a property clears its definition.
    const removed = removeComponentProperty(next, smallId, 'Label text');
    expect(componentOf(removed, smallId).componentPropertyDefinitions?.['Label text']).toBeUndefined();
    expect(componentLibrary(next).map((entry) => entry.name)).toContain('Size=Small');
    void page;
  });

  it('keeps instance overrides for non-variant properties', () => {
    const { file, smallId } = setup();
    const withProp = addComponentProperty(file, smallId, 'TEXT', 'Label text', 'Hi');
    const page = withProp.document.children[0]!;
    const instance: InstanceNode = {
      id: 'inst:2', name: 'Inst', type: 'INSTANCE', visible: true, locked: false, opacity: 1,
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 400 }, width: 50, height: 50, fills: [], strokes: [],
      children: [], componentId: smallId, componentProperties: { 'Label text': 'Custom' },
    };
    page.children = [...page.children, instance];
    const values = resolvedProperties(withProp, instance);
    expect(values['Label text']).toBe('Custom');

    const changed = setInstanceProperty(withProp, 'inst:2', 'Label text', 'Changed');
    expect(resolvedProperties(changed, findNode(changed.document, 'inst:2') as InstanceNode)['Label text']).toBe('Changed');
  });

  it('round-trips sets, definitions and instance properties through JSON', () => {
    const { file, smallId, largeId } = setup();
    const { file: withSet } = createComponentSet(file, [smallId, largeId], 'Button');
    const restored = parseFile(serializeFile(withSet));
    expect(restored.ok).toBe(true);
    const set = findNode(restored.file!.document, withSet.document.children[0]!.children[0]!.id) as ComponentNode;
    expect(set.type).toBe('COMPONENT_SET');
    expect(set.componentPropertyDefinitions).toMatchObject({ Size: { variantOptions: ['Small', 'Large'] } });
    expect((set.children as SceneNode[]).map((child) => child.name)).toEqual(['Size=Small', 'Size=Large']);
  });
});

describe('making a slot', () => {
  /** A component holding one frame; returns the file and the ids. */
  function componentWithFrame() {
    const file = emptyFile('Slots');
    const page = file.document.children[0]!;
    const frame = createFrameNode(file.document, 0, 0, 120, 80, { name: 'Body' });
    const component = { ...createRectNode(file.document, 0, 0, 200, 160), type: 'COMPONENT' as const, name: 'Card', children: [frame] } as unknown as ComponentNode;
    page.children = [component];
    return { file: { ...file, document: file.document }, componentId: component.id, frameId: frame.id };
  }

  it('defines a SLOT on the component and names the frame that holds it', () => {
    const { file, componentId, frameId } = componentWithFrame();
    const result = makeSlot(file, frameId);
    expect(result.reason).toBeUndefined();
    const component = findNode(result.file.document, componentId) as ComponentNode;
    expect(component.componentPropertyDefinitions).toEqual({ Slot: { type: 'SLOT', defaultValue: null } });
    expect(findNode(result.file.document, frameId)!.componentPropertyReferences).toEqual({ slot: 'Slot' });
  });

  it('gives a second slot its own name, and keeps the first', () => {
    const { file, componentId, frameId } = componentWithFrame();
    const once = makeSlot(file, frameId).file;
    const twice = makeSlot(once, frameId).file;
    const definitions = (findNode(twice.document, componentId) as ComponentNode).componentPropertyDefinitions!;
    expect(Object.keys(definitions).sort()).toEqual(['Slot', 'Slot 2'].sort());
  });

  it('refuses a node that is not a frame, and a frame outside any component', () => {
    const { file, frameId } = componentWithFrame();
    const rect = createRectNode(file.document, 0, 0, 10, 10);
    const loose = createFrameNode(file.document, 0, 0, 50, 50, { name: 'Loose' });
    const page = file.document.children[0]!;
    page.children = [...page.children, loose];
    expect(makeSlot(file, rect.id).reason).toMatch(/Select a frame inside a component/);
    expect(makeSlot(file, loose.id).reason, 'a frame outside any component became a slot').toMatch(/Select a frame inside a component/);
    expect(makeSlot(file, frameId).reason).toBeUndefined();
  });
});

describe('suggested components for an INSTANCE_SWAP property', () => {
  /** A file with three components; `keys` maps a component id to its imported library key. */
  function library(keys: Record<string, string> = {}) {
    const file = emptyFile('Swap');
    const page = file.document.children[0]!;
    const ids = ['Icon / Mail', 'Icon / Star', 'Icon / Heart'].map((name) => {
      const rect = createRectNode(file.document, 0, 0, 16, 16);
      const component = { ...rect, type: 'COMPONENT' as const, name, children: [] } as unknown as ComponentNode;
      page.children = [...page.children, component];
      return component.id;
    });
    file.meta = { components: Object.fromEntries(Object.entries(keys).map(([id, key]) => [id, { key }])) };
    return { file, ids };
  }

  it('names a component by its imported library key, and by its id when it has none', () => {
    const { file, ids } = library({});
    expect(componentKey(file, ids[0]!)).toBe(ids[0]);
    const keyed = library({});
    keyed.file.meta = { components: { [keyed.ids[1]!]: { key: 'abc123' } } };
    expect(componentKey(keyed.file, keyed.ids[1]!)).toBe('abc123');
    expect(componentKey(keyed.file, keyed.ids[0]!)).toBe(keyed.ids[0]);
  });

  it('suggests exactly the components the preferred keys name, and matches imported keys too', () => {
    const { file, ids } = library({});
    // A Pigma component is named by its id; an imported one by its library key.
    file.meta = { components: { [ids[0]!]: { key: 'lib-mail' } } };
    const suggested = suggestedComponents(file, [
      { type: 'COMPONENT', key: 'lib-mail' },
      { type: 'COMPONENT', key: ids[2]! },
    ]);
    expect(suggested.map((entry) => entry.id)).toEqual([ids[0], ids[2]]);
  });

  it('suggests nothing when the property has no preferred values', () => {
    const { file } = library({});
    expect(suggestedComponents(file, undefined)).toEqual([]);
    expect(suggestedComponents(file, [])).toEqual([]);
  });
});
