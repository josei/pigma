/**
 * Slot content is reachable from the UI.
 *
 * The model expressed slot content (`NodeOverride.children`) and the sync merged
 * it, but nothing in the app could put content in a slot. `setSlotContent` takes
 * the CURRENT SELECTION as the slot's content — cloned, so the originals stay put
 * — and clearing it restores the component's default.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useEditor } from './editorStore';
import { emptyFile } from '../model/validate';
import { createComponentNode, createFrameNode, createRectNode, createTextNode } from '../model/factory';
import { addComponentProperty, setPropertyReference, slotTargetsOf } from '../model/variants';
import { findNode, updateNode } from '../model/tree';
import { instanceChildId } from '../model/instances';
import type { ComponentNode, ContainerNode, InstanceNode, PigmaFile, SceneNode } from '../model/types';

const store = () => useEditor.getState();
const childrenOf = (file: PigmaFile, id: string): SceneNode[] => (findNode(file.document, id) as ContainerNode).children as SceneNode[];

/** A standalone component with a slot frame, an instance of it, and a spare rect. */
function scene(): { first: string; slotId: string; instanceId: string; spareId: string } {
  const file = emptyFile('Slot content');
  const page = file.document.children[0]!;
  const frame = createFrameNode(file.document, 0, 0, 120, 60);
  const slot = createFrameNode(file.document, 8, 8, 100, 40);
  slot.name = 'Slot';
  const label = createTextNode(file.document, 0, 0, 'Default');
  label.name = 'Default label';
  slot.children = [label];
  frame.children = [slot];
  const component = createComponentNode(file.document, frame);
  component.name = 'Card';
  component.children = [slot];
  const instance: InstanceNode = {
    id: 'inst:1', name: 'Card', type: 'INSTANCE', visible: true, locked: false, opacity: 1,
    transform: { a: 1, b: 0, c: 0, d: 1, tx: 400, ty: 0 }, width: 120, height: 60,
    fills: [], strokes: [], children: [], componentId: component.id,
  };
  const spare = createRectNode(file.document, 0, 0, 20, 20);
  spare.name = 'Spare';
  page.children = [component, instance, spare];
  useEditor.getState().loadFile(file);
  return { first: component.id, slotId: slot.id, instanceId: instance.id, spareId: spare.id };
}

/** Add a SLOT property and bind it to the component's slot frame. */
function withSlot(ids: { first: string; slotId: string }): void {
  const state = store();
  state.loadFile(addComponentProperty(state.file, ids.first, 'SLOT', 'Content', ''));
  state.loadFile(setPropertyReference(store().file, ids.slotId, 'slot', 'Content'));
}

let snapshot: ReturnType<typeof useEditor.getState> | null = null;

beforeEach(() => {
  snapshot = useEditor.getState();
});

afterEach(() => {
  if (snapshot) {
    useEditor.setState(snapshot, true);
    snapshot = null;
  }
});

describe('slot content from the UI', () => {
  it('binds a SLOT property to the component frame, and finds it', () => {
    const ids = scene();
    withSlot(ids);
    const owner = findNode(store().file.document, ids.first) as ComponentNode;
    expect(slotTargetsOf(owner)).toEqual([{ property: 'Content', nodeId: ids.slotId }]);
  });

  it('takes the selection as the slot content, cloning it', () => {
    const ids = scene();
    withSlot(ids);
    const before = store().file;
    // Before: the instance shows the component's default content.
    expect((childrenOf(before, ids.instanceId)[0] as ContainerNode).children.map((child) => child.name)).toEqual(['Default label']);

    store().setSlotContent(ids.instanceId, ids.slotId, [ids.spareId]);
    const after = store().file;
    const supplied = (childrenOf(after, ids.instanceId)[0] as ContainerNode).children as SceneNode[];
    expect(supplied.map((child) => child.name)).toEqual(['Spare']);
    // Cloned: a fresh id, and the original is still on the page where it was.
    expect(supplied[0]!.id).not.toBe(ids.spareId);
    expect(findNode(after.document, ids.spareId)).toBeTruthy();
    // One history entry.
    expect(store().past.length).toBeGreaterThan(0);
    expect(store().past[store().past.length - 1]!.label).toBe('Set slot content');
  });

  it('survives a component edit', () => {
    const ids = scene();
    withSlot(ids);
    store().setSlotContent(ids.instanceId, ids.slotId, [ids.spareId]);
    // Edit the component's slot default.
    const label = childrenOf(store().file, ids.slotId)[0]!;
    store().apply('Edit component', (file) => ({
      ...file,
      document: updateNode(file.document, label.id, (node) => ({ ...node, name: 'Component default changed' }) as SceneNode),
    }));
    const supplied = (childrenOf(store().file, ids.instanceId)[0] as ContainerNode).children as SceneNode[];
    expect(supplied.map((child) => child.name), 'a component edit wiped the slot content').toEqual(['Spare']);
  });

  it('clears back to the component default', () => {
    const ids = scene();
    withSlot(ids);
    store().setSlotContent(ids.instanceId, ids.slotId, [ids.spareId]);
    expect(((childrenOf(store().file, ids.instanceId)[0] as ContainerNode).children as SceneNode[]).map((child) => child.name)).toEqual(['Spare']);

    store().setSlotContent(ids.instanceId, ids.slotId, null);
    const restored = (childrenOf(store().file, ids.instanceId)[0] as ContainerNode).children as SceneNode[];
    expect(restored.map((child) => child.name), 'clear must restore the default').toEqual(['Default label']);
    expect(restored[0]!.id).toBe(instanceChildId(ids.instanceId, childrenOf(store().file, ids.slotId)[0]!.id));
    expect(store().past[store().past.length - 1]!.label).toBe('Reset slot content');
  });

  it('refuses to put the instance, or its own children, into its own slot', () => {
    const ids = scene();
    withSlot(ids);
    const ownChild = (findNode(store().file.document, ids.instanceId) as InstanceNode).children[0]!.id;
    store().setSlotContent(ids.instanceId, ids.slotId, [ids.instanceId, ownChild, ids.spareId]);
    const supplied = (childrenOf(store().file, ids.instanceId)[0] as ContainerNode).children as SceneNode[];
    // Only the spare qualifies: nesting the instance inside itself is refused.
    expect(supplied.map((child) => child.name)).toEqual(['Spare']);
  });

  it('has no slot to bind when the component declares none', () => {
    const ids = scene();
    const owner = findNode(store().file.document, ids.first) as ComponentNode;
    expect(slotTargetsOf(owner), 'a component without a slot property has no slot row').toEqual([]);
  });
});
