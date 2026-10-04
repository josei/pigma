import type {
  ComponentNode,
  ComponentPropertyDefinition,
  ComponentPropertyValue,
  InstanceNode,
  PigmaFile,
  SceneNode,
} from './types';
import { findNode, insertChild, parentAndIndex, removeNode, updateNode, walk } from './tree';
import { nextNodeId } from './ids';
import { syncInstances } from './instances';

/**
 * Variants and component properties (M11).
 *
 * A COMPONENT_SET is a container of COMPONENT children whose names encode their
 * variant values (`Size=Large, State=Hover`), exactly like Figma. The set's
 * `componentPropertyDefinitions` describes each property, and an INSTANCE picks
 * a variant through `componentProperties`, which also re-points `componentId` at
 * the matching variant component so the existing instance sync does the rest.
 *
 * BOOLEAN / TEXT / INSTANCE_SWAP properties live on the instance too, and layers
 * bind to them through `componentPropertyReferences` (resolved at render time by
 * the renderer, like variable bindings).
 */

export function parseVariantName(name: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const part of name.split(',')) {
    const [rawKey, ...rest] = part.split('=');
    const key = rawKey?.trim();
    const value = rest.join('=').trim();
    if (key && value) values[key] = value;
  }
  return values;
}

export function formatVariantName(values: Record<string, string>, order?: string[]): string {
  const keys = order && order.length > 0 ? order : Object.keys(values);
  return keys
    .filter((key) => values[key] !== undefined)
    .map((key) => `${key}=${values[key]}`)
    .join(', ');
}

export function componentPropertiesOf(node: SceneNode): Record<string, ComponentPropertyDefinition> {
  if (node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET') return {};
  return node.componentPropertyDefinitions ?? {};
}

export function instancePropertiesOf(node: SceneNode): Record<string, ComponentPropertyValue> {
  if (node.type !== 'INSTANCE') return {};
  return node.componentProperties ?? {};
}

/** Variant options across a component set's children, keyed by property name. */
export function variantOptions(set: ComponentNode): Record<string, string[]> {
  const options: Record<string, string[]> = {};
  for (const child of set.children as SceneNode[]) {
    if (child.type !== 'COMPONENT') continue;
    for (const [key, value] of Object.entries(parseVariantName(child.name))) {
      const list = options[key] ?? [];
      if (!list.includes(value)) list.push(value);
      options[key] = list;
    }
  }
  return options;
}

/** The component in a set that matches a variant selection. */
export function findVariant(set: ComponentNode, selection: Record<string, string>): SceneNode | null {
  const wanted = Object.entries(selection);
  for (const child of set.children as SceneNode[]) {
    if (child.type !== 'COMPONENT') continue;
    const values = parseVariantName(child.name);
    if (wanted.every(([key, value]) => values[key] === value)) return child;
  }
  return null;
}

/** Effective property values for an instance: the component's defaults plus overrides. */
export function resolvedProperties(file: PigmaFile, instance: InstanceNode): Record<string, ComponentPropertyValue> {
  const main = findNode(file.document, instance.componentId);
  const definitions =
    main && (main.type === 'COMPONENT' || main.type === 'COMPONENT_SET')
      ? componentPropertiesOf(main as ComponentNode)
      : {};
  const out: Record<string, ComponentPropertyValue> = {};
  for (const [name, definition] of Object.entries(definitions)) out[name] = definition.defaultValue;
  // A variant selection is itself a property value.
  if (main && main.type === 'COMPONENT') {
    for (const [key, value] of Object.entries(parseVariantName(main.name))) out[key] = value;
  }
  for (const [name, value] of Object.entries(instancePropertiesOf(instance))) out[name] = value;
  return out;
}

/**
 * Wrap the given components into a component set, deriving one VARIANT property
 * from their names.
 */
export function createComponentSet(
  file: PigmaFile,
  componentIds: string[],
  name = 'Component Set',
): { file: PigmaFile; setId: string | null } {
  const components = componentIds
    .map((id) => findNode(file.document, id))
    .filter((node): node is SceneNode => !!node && node.type === 'COMPONENT');
  if (components.length < 2) return { file, setId: null };
  const parent = parentAndIndex(file.document, components[0]!.id);
  if (!parent) return { file, setId: null };

  const setId = nextNodeId();
  const options: Record<string, string[]> = {};
  for (const component of components) {
    for (const [key, value] of Object.entries(parseVariantName(component.name))) {
      const list = options[key] ?? [];
      if (!list.includes(value)) list.push(value);
      options[key] = list;
    }
  }
  const definitions: Record<string, ComponentPropertyDefinition> = {};
  for (const [key, values] of Object.entries(options)) {
    definitions[key] = { type: 'VARIANT', defaultValue: values[0] ?? '', variantOptions: values };
  }

  let document = file.document;
  const index = parent.index;
  const removed: SceneNode[] = [];
  for (const component of components) {
    const stripped = removeNode(document, component.id);
    document = stripped.root;
    if (stripped.removed) removed.push(stripped.removed);
  }
  const set: ComponentNode = {
    id: setId,
    name,
    type: 'COMPONENT_SET',
    visible: true,
    locked: false,
    opacity: 1,
    transform: { a: 1, b: 0, c: 0, d: 1, tx: removed[0]?.transform.tx ?? 0, ty: removed[0]?.transform.ty ?? 0 },
    width: Math.max(...removed.map((component) => component.width), 1),
    height: Math.max(...removed.map((component) => component.height), 1),
    fills: [],
    strokes: [],
    children: removed,
    clipsContent: false,
    componentPropertyDefinitions: definitions,
  };
  document = insertChild(document, parent.parent.id, set, index);
  return { file: { ...file, document }, setId };
}

/** The component set that owns a component, if any. */
export function componentSetOf(file: PigmaFile, componentId: string): ComponentNode | null {
  const parent = parentAndIndex(file.document, componentId);
  if (parent && parent.parent.type === 'COMPONENT_SET') return parent.parent as ComponentNode;
  return null;
}

/** Switch an instance to another variant of its set. */
export function setInstanceVariant(
  file: PigmaFile,
  instanceId: string,
  property: string,
  value: string,
): PigmaFile {
  const instance = findNode(file.document, instanceId);
  if (!instance || instance.type !== 'INSTANCE') return file;
  const set = componentSetOf(file, instance.componentId);
  if (!set) return file;
  const selection = { ...parseVariantName(findNode(file.document, instance.componentId)?.name ?? ''), [property]: value };
  const variant = findVariant(set, selection);
  if (!variant) return file;
  const properties = { ...instancePropertiesOf(instance), [property]: value };
  // Figma resizes an instance to the variant it switches to, so carry the new
  // component's box and appearance across.
  const next = updateNode(file.document, instanceId, (node) => ({
    ...node,
    componentId: variant.id,
    componentProperties: properties,
    children: [],
    width: variant.width,
    height: variant.height,
    fills: variant.fills.map((paint) => ({ ...paint })),
    strokes: variant.strokes.map((paint) => ({ ...paint })),
    strokeWeight: variant.strokeWeight,
    cornerRadius: variant.cornerRadius,
    effects: (variant.effects ?? []).map((effect) => ({ ...effect })),
  }) as SceneNode);
  return { ...file, document: syncInstances(next) };
}

/** Set any non-variant property on an instance. */
export function setInstanceProperty(
  file: PigmaFile,
  instanceId: string,
  name: string,
  value: ComponentPropertyValue,
): PigmaFile {
  const instance = findNode(file.document, instanceId);
  if (!instance || instance.type !== 'INSTANCE') return file;
  const properties = { ...instancePropertiesOf(instance), [name]: value };
  const next = updateNode(file.document, instanceId, (node) => ({ ...node, componentProperties: properties }) as SceneNode);
  return { ...file, document: syncInstances(next) };
}

/** Add a BOOLEAN / TEXT / INSTANCE_SWAP property to a main component. */
export function addComponentProperty(
  file: PigmaFile,
  componentId: string,
  type: Exclude<ComponentPropertyDefinition['type'], 'VARIANT'>,
  name: string,
  defaultValue: ComponentPropertyValue,
): PigmaFile {
  // Properties on a variant belong to the whole set, like Figma: every variant
  // shares them so instances can be driven regardless of the variant in use.
  const set = componentSetOf(file, componentId);
  const targetId = set ? set.id : componentId;
  const component = findNode(file.document, targetId);
  if (!component || (component.type !== 'COMPONENT' && component.type !== 'COMPONENT_SET')) return file;
  const definitions = { ...componentPropertiesOf(component as ComponentNode), [name]: { type, defaultValue } };
  const document = updateNode(file.document, targetId, (node) => ({
    ...node,
    componentPropertyDefinitions: definitions,
  }) as SceneNode);
  return { ...file, document: syncInstances(document) };
}

export function removeComponentProperty(file: PigmaFile, componentId: string, name: string): PigmaFile {
  const set = componentSetOf(file, componentId);
  const targetId = set ? set.id : componentId;
  const component = findNode(file.document, targetId);
  if (!component || (component.type !== 'COMPONENT' && component.type !== 'COMPONENT_SET')) return file;
  const definitions = { ...componentPropertiesOf(component as ComponentNode) };
  delete definitions[name];
  const document = updateNode(file.document, targetId, (node) => ({
    ...node,
    componentPropertyDefinitions: definitions,
  }) as SceneNode);
  return { ...file, document: syncInstances(document) };
}

/** All main components in the file (for INSTANCE_SWAP pickers). */
export function componentLibrary(file: PigmaFile): Array<{ id: string; name: string }> {
  const out: Array<{ id: string; name: string }> = [];
  walk(file.document, (node) => {
    if (node.type === 'COMPONENT') out.push({ id: node.id, name: node.name });
  });
  return out;
}

/**
 * Effective overrides for a layer inside an instance, driven by the instance's
 * component property values (`componentPropertyReferences`).
 */
export function resolvePropertyReferences(
  node: SceneNode,
  values: Record<string, ComponentPropertyValue>,
): { visible?: boolean; characters?: string } | null {
  const references = node.componentPropertyReferences;
  if (!references) return null;
  const out: { visible?: boolean; characters?: string } = {};
  for (const [kind, property] of Object.entries(references)) {
    const value = values[property];
    if (value === undefined) continue;
    if (kind === 'visible' && typeof value === 'boolean') out.visible = value;
    if (kind === 'characters' && typeof value === 'string') out.characters = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Bind a layer inside a component to one of its properties. */
export function setPropertyReference(
  file: PigmaFile,
  nodeId: string,
  kind: string,
  property: string | null,
): PigmaFile {
  const node = findNode(file.document, nodeId);
  if (!node || node.type === 'DOCUMENT' || node.type === 'CANVAS') return file;
  const references = { ...(node.componentPropertyReferences ?? {}) };
  if (property) references[kind] = property;
  else delete references[kind];
  const document = updateNode(file.document, nodeId, (target) => ({ ...target, componentPropertyReferences: references }) as SceneNode);
  return { ...file, document: syncInstances(document) };
}

/** Children of a component set (its variants). */
export function variantsOf(set: ComponentNode): SceneNode[] {
  return (set.children as SceneNode[]).filter((child) => child.type === 'COMPONENT');
}

export function describeVariant(component: SceneNode): string {
  const values = parseVariantName(component.name);
  const entries = Object.entries(values);
  return entries.length > 0 ? entries.map(([key, value]) => `${key}: ${value}`).join(' · ') : component.name;
}

