/**
 * Instances settle at scale.
 *
 * `syncInstances` resolved each instance's component with `findNode(scope, id)`
 * inside its per-instance loop, so a document with many instances was
 * O(instances x nodes): 500 / 1000 / 2000 / 4000 instances took 89 / 290 / 1093
 * / 4728 ms, and it runs on every write. Components are now resolved through one
 * id index built by a single walk (3.6 / 6.0 / 15.0 / 26.4 ms for the pass).
 *
 * These tests hold the behaviour still at scale, including the reason the lookup
 * is rooted at the document: a component may live on another page.
 */
import { describe, expect, it } from 'vitest';
import { emptyFile } from '../../src/model/validate';
import { createFrameNode, createRectNode, createTextNode } from '../../src/model/factory';
import { syncInstances, instanceChildId } from '../../src/model/instances';
import { settleDocument } from '../../src/model/settle';
import { findNode, updateNode } from '../../src/model/tree';
import type { AnyNode, InstanceNode, PigmaFile, SceneNode } from '../../src/model/types';

const COMPONENTS = 20;

/** A component with two children, and instances of them spread across the page. */
function scene(instances: number): { file: PigmaFile; componentIds: string[]; instanceIds: string[] } {
  const file = emptyFile('Many instances');
  const page = file.document.children[0]!;
  const componentIds: string[] = [];
  const instanceIds: string[] = [];
  const components: SceneNode[] = [];
  for (let i = 0; i < COMPONENTS; i += 1) {
    const component = createFrameNode(null, 0, 0, 100, 60, { name: `Card ${i}` });
    const label = createTextNode(null, 8, 8, `Title ${i}`);
    label.name = 'Label';
    component.children = [label, createRectNode(null, 8, 30, 40, 20)];
    components.push(component);
    componentIds.push(component.id);
  }
  const built: InstanceNode[] = [];
  for (let i = 0; i < instances; i += 1) {
    const component = components[i % COMPONENTS]!;
    const id = `inst:${i}`;
    built.push({
      id,
      name: component.name,
      type: 'INSTANCE',
      visible: true,
      locked: false,
      opacity: 1,
      transform: { a: 1, b: 0, c: 0, d: 1, tx: (i % 40) * 120, ty: Math.floor(i / 40) * 80 },
      width: component.width,
      height: component.height,
      fills: [],
      strokes: [],
      children: [],
      componentId: component.id,
    });
    instanceIds.push(id);
  }
  // Instances first, components after: the shape that made a per-instance root
  // lookup walk the whole page.
  page.children = [...built, ...components];
  return { file, componentIds, instanceIds };
}

const childrenOf = (root: AnyNode, id: string): AnyNode[] => {
  const node = findNode(root, id);
  if (!node || !('children' in node)) throw new Error(`no container ${id}`);
  return (node as { children: AnyNode[] }).children;
};

describe('instances at scale', () => {
  it('materializes every instance from its component', () => {
    const { file, instanceIds, componentIds } = scene(400);
    const synced = syncInstances(file.document);
    expect(instanceIds).toHaveLength(400);
    for (const [index, id] of instanceIds.entries()) {
      const children = childrenOf(synced, id);
      expect(children, `instance ${id} was not materialized`).toHaveLength(2);
      const component = findNode(synced, componentIds[index % COMPONENTS]!);
      const componentChildren = (component as { children: AnyNode[] }).children;
      expect(children.map((child) => child.id)).toEqual(
        componentChildren.map((child) => instanceChildId(id, child.id)),
      );
    }
  });

  it('propagates a component edit to every instance of it', () => {
    const { file, componentIds, instanceIds } = scene(200);
    const target = componentIds[0]!;
    const labelId = childrenOf(file.document, target)[0]!.id;
    const edited = updateNode(file.document, labelId, (node) => ({ ...node, name: 'Edited label' }) as typeof node);
    const synced = syncInstances(edited);
    const instancesOfTarget = instanceIds.filter((_, index) => index % COMPONENTS === 0);
    expect(instancesOfTarget.length).toBeGreaterThan(5);
    for (const id of instancesOfTarget) {
      const child = childrenOf(synced, id)[0]!;
      expect(child.name, `instance ${id} did not pick up the component edit`).toBe('Edited label');
      expect(child.id).toBe(instanceChildId(id, labelId));
    }
  });

  it('keeps overrides applied', () => {
    const { file, instanceIds } = scene(50);
    const id = instanceIds[0]!;
    // Override the instance's label by component node id, as the model does.
    const component = findNode(file.document, (findNode(file.document, id) as InstanceNode).componentId)!;
    const componentLabelId = (component as { children: AnyNode[] }).children[0]!.id;
    const withOverride = updateNode(file.document, id, (node) => ({
      ...node,
      overrides: { [componentLabelId]: { name: 'Overridden', characters: 'Overridden text' } },
    }) as typeof node);
    const synced = syncInstances(withOverride);
    const label = childrenOf(synced, id)[0]!;
    expect(label.name).toBe('Overridden');
    expect(label.type).toBe('TEXT');
    expect((label as { characters?: string }).characters).toBe('Overridden text');
  });

  it('resolves a component that lives on another page', () => {
    // The index is built from the document root for exactly this reason.
    const { file, componentIds, instanceIds } = scene(20);
    const page = file.document.children[0]!;
    const second = { ...page, id: 'page:2', name: 'Page 2', children: [] as SceneNode[] };
    const component = findNode(file.document, componentIds[0]!) as SceneNode;
    const moved = updateNode(file.document, page.id, (node) => ({
      ...node,
      children: (node as { children: SceneNode[] }).children.filter((child) => child.id !== component.id),
    }) as typeof node);
    const withSecond = { ...moved, children: [...moved.children, { ...second, children: [component] }] };
    const synced = syncInstances(withSecond as typeof moved);
    const instancesOfMoved = instanceIds.filter((_, index) => index % COMPONENTS === 0);
    for (const id of instancesOfMoved) {
      expect(childrenOf(synced, id), `instance ${id} lost its cross-page component`).toHaveLength(2);
    }
  });

  it('is the same object when nothing changed, with many instances', () => {
    const { file } = scene(300);
    const settled = settleDocument(file);
    // Identity, not equality: a repeated write must not churn.
    expect(settleDocument(settled)).toBe(settled);
    expect(syncInstances(settled.document)).toBe(settled.document);
  });
});
