import { describe, expect, it } from 'vitest';
import {
  addComponentProperty,
  componentLibrary,
  componentSetOf,
  createComponentSet,
  describeVariant,
  findVariant,
  formatVariantName,
  parseVariantName,
  removeComponentProperty,
  resolvedProperties,
  resolvePropertyReferences,
  setInstanceProperty,
  setInstanceVariant,
  setPropertyReference,
  variantOptions,
} from './variants';
import { createRectNode, createTextNode } from './factory';
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
