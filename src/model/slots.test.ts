/**
 * Component slots — step 1: the half the model already expresses.
 *
 * Figma's slot properties are INSTANCE_SWAP properties bound to a layer
 * (`componentPropertyReferences.mainComponent`). Three behaviours a slot needs
 * were already expressible, and two of them were NOT honoured before this:
 *  - a preferred instance: setting the property to a component id makes the
 *    instance use that component;
 *  - a component edit propagating while that choice SURVIVES;
 *  - a reset restoring the default.
 * The defaults half (a component's own children are the slot's default content)
 * needed no change at all. This file proves all three.
 */
import { describe, expect, it } from 'vitest';
import { emptyFile } from './validate';
import { parseFile, serializeFile } from './serialize';
import { createComponentNode, createFrameNode, createTextNode } from './factory';
import { syncInstances, instanceChildId } from './instances';
import {
  addComponentProperty,
  componentPropertiesOf,
  instancePropertiesOf,
  propertyOwnerOf,
  resolvePropertyReferences,
  resolvedProperties,
  setInstanceProperty,
  setPropertyReference,
} from './variants';
import { findNode, updateNode } from './tree';
import { createComponentSet } from './variants';
import { createRectNode } from './factory';
import type { ComponentNode, ContainerNode, InstanceNode, PigmaFile, SceneNode } from './types';

/** A component with a label child, named so the two are distinguishable. */
function component(file: PigmaFile, name: string): ComponentNode {
  const frame = createFrameNode(file.document, 0, 0, 120, 60);
  // A slot frame holding the default content, which is what a SLOT property is
  // bound to and what an override replaces.
  const slot = createFrameNode(file.document, 8, 8, 100, 40);
  slot.name = `${name} slot`;
  const label = createTextNode(file.document, 0, 0, name);
  label.name = `${name} label`;
  slot.children = [label];
  frame.children = [slot];
  const component = createComponentNode(file.document, frame);
  component.name = name;
  component.children = [slot];
  return component;
}

/** The slot frame inside a component. */
const slotOf = (file: PigmaFile, componentId: string): SceneNode => childrenOf(file, componentId)[0]!;

/** The children of a container node, typed for the assertions below. */
const slotChildren = (file: PigmaFile, instanceId: string): SceneNode[] =>
  (childrenOf(file, instanceId)[0] as ContainerNode).children as SceneNode[];

/** A file with two components and one instance of the first. */
function scene(): { file: PigmaFile; first: string; second: string; instanceId: string } {
  const file = emptyFile('Slots');
  const page = file.document.children[0]!;
  const first = component(file, 'Alpha');
  const second = component(file, 'Beta');
  const instance: InstanceNode = {
    id: 'inst:1',
    name: 'Alpha instance',
    type: 'INSTANCE',
    visible: true,
    locked: false,
    opacity: 1,
    transform: { a: 1, b: 0, c: 0, d: 1, tx: 400, ty: 0 },
    width: 120,
    height: 60,
    fills: [],
    strokes: [],
    children: [],
    componentId: first.id,
  };
  page.children = [first, second, instance];
  return { file, first: first.id, second: second.id, instanceId: instance.id };
}

const childrenOf = (file: PigmaFile, id: string): SceneNode[] => (findNode(file.document, id) as ContainerNode).children as SceneNode[];

describe('component slots, step 1', () => {
  it('takes a preferred component when the swap property is set', () => {
    const { file, first, second, instanceId } = scene();
    // The property lives on the main component, bound to the instance's root.
    const withProperty = addComponentProperty(file, first, 'INSTANCE_SWAP', 'Content', second);
    const bound = setPropertyReference(withProperty, instanceId, 'mainComponent', 'Content');
    // Before a value is set, the instance still materializes its own component.
    expect((childrenOf(bound, instanceId)[0] as ContainerNode).children[0]!.name).toBe('Alpha label');

    const swapped = setInstanceProperty(bound, instanceId, 'Content', second);
    const instance = findNode(swapped.document, instanceId) as InstanceNode;
    expect(instance.componentId, 'the instance keeps its own component id').toBe(first);
    // ...but materializes the preferred one.
    expect((childrenOf(swapped, instanceId)[0] as ContainerNode).children[0]!.name, 'the preferred component was not used').toBe('Beta label');
    expect(childrenOf(swapped, instanceId)[0]!.id).toBe(instanceChildId(instanceId, slotOf(swapped, second).id));
  });

  it('keeps the preferred choice while a component edit propagates', () => {
    const { file, first, second, instanceId } = scene();
    const withProperty = addComponentProperty(file, first, 'INSTANCE_SWAP', 'Content', second);
    const bound = setPropertyReference(withProperty, instanceId, 'mainComponent', 'Content');
    const swapped = setInstanceProperty(bound, instanceId, 'Content', second);
    expect((childrenOf(swapped, instanceId)[0] as ContainerNode).children[0]!.name).toBe('Beta label');

    // Edit BOTH components: each instance follows its own.
    const edited = {
      ...swapped,
      document: swapped.document,
    };
    const alphaLabel = childrenOf(edited, slotOf(edited, first).id)[0]!;
    const betaLabel = childrenOf(edited, slotOf(edited, second).id)[0]!;
    const rename = (id: string, name: string): void => {
      const node = findNode(edited.document, id) as SceneNode;
      (node as { name: string }).name = name;
    };
    rename(alphaLabel.id, 'Alpha edited');
    rename(betaLabel.id, 'Beta edited');
    const synced = syncInstances(edited.document);
    const instance = findNode(synced, instanceId) as InstanceNode;
    expect(instancePropertiesOf(instance).Content, 'the swap choice must survive a component edit').toBe(second);
    expect((childrenOf({ ...edited, document: synced }, instanceId)[0] as ContainerNode).children[0]!.name, 'the edit did not reach the swapped component').toBe('Beta edited');
  });

  it('restores the default when the swap is reset', () => {
    const { file, first, second, instanceId } = scene();
    const withProperty = addComponentProperty(file, first, 'INSTANCE_SWAP', 'Content', second);
    const bound = setPropertyReference(withProperty, instanceId, 'mainComponent', 'Content');
    const swapped = setInstanceProperty(bound, instanceId, 'Content', second);
    expect((childrenOf(swapped, instanceId)[0] as ContainerNode).children[0]!.name).toBe('Beta label');

    // Reset: clear the value, and the instance falls back to its own component —
    // which is the slot's default content.
    const reset = setInstanceProperty(swapped, instanceId, 'Content', '');
    expect(instancePropertiesOf(findNode(reset.document, instanceId) as InstanceNode).Content).toBe('');
    expect((childrenOf(reset, instanceId)[0] as ContainerNode).children[0]!.name, 'reset must restore the default').toBe('Alpha label');
  });

  it('keeps the swap through a JSON round trip', () => {
    const { file, first, second, instanceId } = scene();
    const withProperty = addComponentProperty(file, first, 'INSTANCE_SWAP', 'Content', second);
    const bound = setPropertyReference(withProperty, instanceId, 'mainComponent', 'Content');
    const swapped = setInstanceProperty(bound, instanceId, 'Content', second);
    const reloaded = parseFile(serializeFile(swapped)).file!;
    const instance = findNode(reloaded.document, instanceId) as InstanceNode;
    expect(instance.componentPropertyReferences?.mainComponent).toBe('Content');
    expect(instancePropertiesOf(instance).Content).toBe(second);
    const synced = syncInstances(reloaded.document);
    expect((childrenOf({ ...reloaded, document: synced }, instanceId)[0] as ContainerNode).children[0]!.name).toBe('Beta label');
  });

  it('keeps instance-supplied slot content across a component edit', () => {
    // The merge that matters: a component edit re-materializes the instance, and
    // the content the instance supplied for the slot must survive it.
    const { file, first, instanceId } = scene();
    const slotId = slotOf(file, first).id;
    const supplied = createRectNode(file.document, 0, 0, 30, 30);
    supplied.name = 'Supplied content';
    const withContent = {
      ...file,
      document: updateNode(file.document, instanceId, (node) => ({
        ...node,
        overrides: { [slotId]: { children: [supplied] } },
      }) as SceneNode),
    };
    const firstSync = syncInstances(withContent.document);
    expect(slotChildren({ ...withContent, document: firstSync }, instanceId).map((child) => child.name), 'the supplied content was not used').toEqual(['Supplied content']);

    // Now edit the component: the slot's own children change, and the supplied
    // content must still be there.
    const componentLabel = childrenOf(withContent, slotId)[0]!;
    const edited = updateNode(firstSync, componentLabel.id, (node) => ({ ...node, name: 'Component default changed' }) as typeof node);
    const synced = syncInstances(edited);
    expect(slotChildren({ ...withContent, document: synced }, instanceId).map((child) => child.name), 'a component edit wiped the slot content').toEqual(['Supplied content']);
    // And the override is still on the instance, so a later reset can drop it.
    const instance = findNode(synced, instanceId) as InstanceNode;
    expect(Object.keys(instance.overrides ?? {})).toEqual([slotId]);
  });

  it('restores the component default when the slot override is dropped', () => {
    const { file, first, instanceId } = scene();
    const slotId = slotOf(file, first).id;
    const supplied = createRectNode(file.document, 0, 0, 30, 30);
    supplied.name = 'Supplied content';
    const withContent = {
      ...file,
      document: updateNode(file.document, instanceId, (node) => ({ ...node, overrides: { [slotId]: { children: [supplied] } } }) as SceneNode),
    };
    expect(slotChildren({ ...withContent, document: syncInstances(withContent.document) }, instanceId).map((child) => child.name)).toEqual(['Supplied content']);

    // Reset: drop the override, and the component's own children are the default.
    const cleared = updateNode(withContent.document, instanceId, (node) => {
      const overrides = { ...((node as InstanceNode).overrides ?? {}) };
      delete overrides[slotId];
      return { ...node, overrides } as SceneNode;
    });
    const synced = syncInstances(cleared);
    expect(slotChildren({ ...withContent, document: synced }, instanceId).map((child) => child.name), 'reset must restore the default').toEqual(['Alpha label']);
  });

  it('offers every property control for an instance of a STANDALONE component', () => {
    // The defect QA pinned: the panel resolved definitions from the instance
    // node, which owns none, so BOOLEAN, TEXT and INSTANCE_SWAP controls all
    // disappeared for instances of standalone components.
    const { file, first, instanceId } = scene();
    let withProperties = addComponentProperty(file, first, 'BOOLEAN', 'Show label', true);
    withProperties = addComponentProperty(withProperties, first, 'TEXT', 'Label text', 'Default label');
    withProperties = addComponentProperty(withProperties, first, 'INSTANCE_SWAP', 'Content', '');
    const instance = findNode(withProperties.document, instanceId) as InstanceNode;
    const owner = propertyOwnerOf(withProperties, instance);
    expect(owner?.id, 'the owner must be the main component, not the instance').toBe(first);
    const definitions = componentPropertiesOf(owner!);
    expect(Object.keys(definitions).sort()).toEqual(['Content', 'Label text', 'Show label']);
    expect(definitions['Show label']!.type).toBe('BOOLEAN');
    expect(definitions['Label text']!.type).toBe('TEXT');
    expect(definitions.Content!.type).toBe('INSTANCE_SWAP');
    // The values the controls read already resolve, defaults included.
    const values = resolvedProperties(withProperties, instance);
    expect(values['Show label']).toBe(true);
    expect(values['Label text']).toBe('Default label');
  });

  it('propagates a BOOLEAN and a TEXT value to the instance children', () => {
    const { file, first, instanceId } = scene();
    let withProperties = addComponentProperty(file, first, 'BOOLEAN', 'Show label', true);
    withProperties = addComponentProperty(withProperties, first, 'TEXT', 'Label text', 'Default label');
    // Bind the component's label to both properties, then drive them.
    const labelId = childrenOf(withProperties, slotOf(withProperties, first).id)[0]!.id;
    const bound = setPropertyReference(setPropertyReference(withProperties, labelId, 'visible', 'Show label'), labelId, 'characters', 'Label text');
    const instanceLabelId = instanceChildId(instanceId, labelId);

    const shown = resolvedProperties(bound, findNode(bound.document, instanceId) as InstanceNode);
    const child = findNode(bound.document, instanceLabelId) as SceneNode;
    expect(resolvePropertyReferences(child, shown)).toEqual({ visible: true, characters: 'Default label' });

    const hidden = setInstanceProperty(bound, instanceId, 'Show label', false);
    const changed = setInstanceProperty(hidden, instanceId, 'Label text', 'Edited text');
    const values = resolvedProperties(changed, findNode(changed.document, instanceId) as InstanceNode);
    expect(resolvePropertyReferences(findNode(changed.document, instanceLabelId) as SceneNode, values)).toEqual({
      visible: false,
      characters: 'Edited text',
    });
  });

  it('keeps the values through a JSON round trip, for a standalone component', () => {
    const { file, first, instanceId } = scene();
    let withProperties = addComponentProperty(file, first, 'BOOLEAN', 'Show label', true);
    withProperties = addComponentProperty(withProperties, first, 'TEXT', 'Label text', 'Default label');
    const changed = setInstanceProperty(setInstanceProperty(withProperties, instanceId, 'Show label', false), instanceId, 'Label text', 'Round tripped');
    const reloaded = parseFile(serializeFile(changed)).file!;
    const instance = findNode(reloaded.document, instanceId) as InstanceNode;
    expect(propertyOwnerOf(reloaded, instance)?.id).toBe(first);
    expect(Object.keys(componentPropertiesOf(propertyOwnerOf(reloaded, instance)!)).sort()).toEqual(['Label text', 'Show label']);
    const values = resolvedProperties(reloaded, instance);
    expect(values['Show label']).toBe(false);
    expect(values['Label text']).toBe('Round tripped');
  });

  it('leaves an instance inside a component set unchanged', () => {
    // Inside a set the definitions still come from the SET, which every variant
    // shares — the standalone case must not have changed that.
    const { file, first, second, instanceId } = scene();
    // A real set first, then the property: `addComponentProperty` routes it to
    // the set, which every variant shares.
    const { file: grouped, setId } = createComponentSet(file, [first, second], 'Set');
    const withSet = addComponentProperty(grouped, first, 'BOOLEAN', 'Show label', true);
    const instance = findNode(withSet.document, instanceId) as InstanceNode;
    const owner = propertyOwnerOf(withSet, instance);
    expect(owner?.type, 'a set instance still resolves to the set').toBe('COMPONENT_SET');
    expect(owner?.id).toBe(setId);
    expect(Object.keys(componentPropertiesOf(owner!)), 'the shared property survives on the set').toContain('Show label');
  });

  it('needs no model change for the defaults half', () => {
    // A slot's default content is the component's own children: an instance with
    // no swap value materializes exactly those, with deterministic ids.
    const { file, first, instanceId } = scene();
    const synced = syncInstances(file.document);
    const componentChildren = childrenOf({ ...file, document: synced }, first);
    const instanceChildren = childrenOf({ ...file, document: synced }, instanceId);
    expect(instanceChildren.map((child) => child.id)).toEqual(
      componentChildren.map((child) => instanceChildId(instanceId, child.id)),
    );
    expect(instanceChildren.map((child) => child.name)).toEqual(componentChildren.map((child) => child.name));
  });
});
