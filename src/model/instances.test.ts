import { describe, expect, it } from 'vitest';
import {
  applyOverride,
  componentNodeIdOf,
  instanceAncestryOf,
  instanceChildId,
  syncInstances,
  withOverride,
} from './instances';
import { createFrameNode, createRectNode, createTextNode } from './factory';
import { emptyFile } from './validate';
import { findNode, updateNode } from './tree';
import type { AnyNode, InstanceNode, SceneNode, TextNode } from './types';
import { hasChildren } from './types';

function container(node: AnyNode | null | undefined) {
  if (!node || !hasChildren(node)) throw new Error('expected a container node');
  return node;
}

function setup() {
  const file = emptyFile('Components');
  const page = file.document.children[0]!;
  const component = createFrameNode(null, 0, 0, 200, 100, { name: 'Card' });
  const label = createTextNode(null, 12, 12, 'Title');
  label.name = 'Label';
  const box = createRectNode(null, 12, 40, 80, 40);
  component.children = [label, box];
  page.children = [component];

  const instance: InstanceNode = {
    id: 'inst:1',
    name: 'Card',
    type: 'INSTANCE',
    visible: true,
    locked: false,
    opacity: 1,
    transform: { a: 1, b: 0, c: 0, d: 1, tx: 400, ty: 0 },
    width: 200,
    height: 100,
    fills: [],
    strokes: [],
    children: [],
    componentId: component.id,
  };
  page.children = [component, instance];
  return { file, componentId: component.id, labelId: label.id, boxId: box.id, instanceId: instance.id };
}

describe('component instances', () => {
  it('materializes the component subtree with deterministic ids', () => {
    const { file, instanceId, labelId, boxId } = setup();
    const synced = syncInstances(file.document);
    const instance = findNode(synced, instanceId) as InstanceNode;
    expect(instance.children.map((child) => child.id)).toEqual([
      instanceChildId(instanceId, labelId),
      instanceChildId(instanceId, boxId),
    ]);
    expect(componentNodeIdOf(instanceChildId(instanceId, labelId))).toBe(labelId);
    expect(componentNodeIdOf('plain')).toBeNull();
  });

  it('propagates component edits to every instance', () => {
    const { file, componentId, instanceId, labelId } = setup();
    const first = syncInstances(file.document);
    const edited = updateNode(first, componentId, (node) => ({ ...node, width: 320 }) as SceneNode);
    const afterEdit = syncInstances(edited);
    const instance = findNode(afterEdit, instanceId) as InstanceNode;
    expect(instance.children[0]!.id).toBe(instanceChildId(instanceId, labelId));

    const text = updateNode(afterEdit, componentId, (node) => {
      const children = (node as { children: SceneNode[] }).children.map((child) =>
        child.type === 'TEXT' ? ({ ...child, characters: 'Updated' } as TextNode) : child,
      );
      return { ...node, children } as SceneNode;
    });
    const propagated = syncInstances(text);
    const instanceText = findNode(propagated, instanceChildId(instanceId, labelId))!;
    expect(instanceText.type).toBe('TEXT');
    if (instanceText.type === 'TEXT') expect(instanceText.characters).toBe('Updated');
  });

  it('keeps overrides through component edits', () => {
    const { file, componentId, instanceId, labelId } = setup();
    const synced = syncInstances(file.document);
    const withOvr = {
      ...file,
      document: withOverride(synced, instanceId, labelId, { characters: 'Custom', opacity: 0.5 }),
    };
    const applied = syncInstances(withOvr.document);
    const instance = findNode(applied, instanceId) as InstanceNode;
    const overridden = instance.children[0]!;
    expect(overridden.opacity).toBe(0.5);
    if (overridden.type === 'TEXT') expect(overridden.characters).toBe('Custom');

    // Editing the master afterwards keeps the override but still syncs the rest.
    const edited = updateNode(applied, componentId, (node) => ({ ...node, name: 'Renamed card' }) as SceneNode);
    const resynced = syncInstances(edited);
    const instanceAfter = findNode(resynced, instanceId) as InstanceNode;
    const stillOverridden = instanceAfter.children[0]!;
    if (stillOverridden.type === 'TEXT') expect(stillOverridden.characters).toBe('Custom');
    const componentChildren = container(findNode(resynced, componentId)).children as SceneNode[];
    expect(instanceAfter.children[1]!.id).toBe(instanceChildId(instanceId, componentChildren[1]!.id));
  });

  it('applies geometry and appearance overrides', () => {
    const { file, instanceId, labelId } = setup();
    const synced = syncInstances(file.document);
    const target = findNode(synced, instanceChildId(instanceId, labelId)) as SceneNode;
    const overridden = applyOverride(target, {
      x: 24,
      y: 30,
      width: 90,
      height: 22,
      fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }],
    });
    expect(overridden.transform.tx).toBe(24);
    expect(overridden.transform.ty).toBe(30);
    expect(overridden.width).toBe(90);
    expect(overridden.height).toBe(22);
    expect(overridden.fills[0]).toMatchObject({ type: 'SOLID' });
  });

  it('locates the instance that owns a nested node', () => {
    const { file, instanceId, labelId } = setup();
    const synced = syncInstances(file.document);
    const childId = instanceChildId(instanceId, labelId);
    const ancestry = instanceAncestryOf(synced, childId);
    expect(ancestry?.instance.id).toBe(instanceId);
    expect(ancestry?.componentNodeId).toBe(labelId);
    expect(instanceAncestryOf(synced, labelId)).toBeNull();
  });

  it('does nothing when there is no component to sync from', () => {
    const { file, instanceId } = setup();
    const orphaned = updateNode(file.document, instanceId, (node) => ({ ...node, componentId: 'missing' }) as SceneNode);
    expect(syncInstances(orphaned)).toBe(orphaned);
  });

  it('leaves documents without instances untouched', () => {
    const file = emptyFile('Plain');
    expect(syncInstances(file.document)).toBe(file.document);
  });
});
