import type { LayoutGrid, NodeStyleBinding, PigmaFile, SceneNode, StyleDefinition, StyleType } from './types';
import { findNode, updateNode } from './tree';
import { nextNodeId } from './ids';

/**
 * Local styles (M11).
 *
 * Figma keeps a file-level styles table and each node carries a binding:
 *
 *   file.styles = { 'S:1': { key, name, type, description } }
 *   node.styles = { fill: 'S:1', text: 'S:2', effect: 'S:3' }
 *
 * Applying a style copies its payload onto the node (so rendering needs no
 * lookup) and records the binding, which is what lets the UI say "Fill · Brand"
 * and detach later. Payloads live in the table so a style can be re-applied and
 * re-edited in one place.
 */

export type { NodeStyleBinding, StyleDefinition, StyleType };

export function stylesOf(file: PigmaFile): Record<string, StyleDefinition> {
  return (file.styles ?? {}) as Record<string, StyleDefinition>;
}

export function styleBindingOf(node: SceneNode): NodeStyleBinding {
  return (node.styles ?? {}) as NodeStyleBinding;
}

function payloadOf(node: SceneNode, type: StyleType): Partial<StyleDefinition> | null {
  switch (type) {
    case 'FILL':
      return node.fills.length > 0 ? { paints: node.fills.map((paint) => ({ ...paint })) } : null;
    case 'EFFECT':
      return (node.effects ?? []).length > 0 ? { effects: (node.effects ?? []).map((effect) => ({ ...effect })) } : null;
    case 'TEXT':
      return node.type === 'TEXT' ? { text: { ...node.style } } : null;
    case 'GRID': {
      // `layoutGrids` lives on containers (frames), which is where a grid style's
      // payload comes from.
      const grids = (node as { layoutGrids?: LayoutGrid[] }).layoutGrids ?? [];
      return grids.length > 0 ? { layoutGrids: grids.map((grid) => ({ ...grid })) } : null;
    }
    default:
      return null;
  }
}

/** Create a style from a node and bind that node to it. */
export function createStyleFromNode(
  file: PigmaFile,
  id: string,
  type: StyleType,
  name?: string,
): { file: PigmaFile; styleId: string | null } {
  const node = findNode(file.document, id);
  if (!node || node.type === 'DOCUMENT' || node.type === 'CANVAS') return { file, styleId: null };
  const payload = payloadOf(node, type);
  if (!payload) return { file, styleId: null };

  const styleId = nextNodeId();
  const definition: StyleDefinition = {
    key: styleId,
    name: name ?? defaultStyleName(type, file),
    type,
    ...payload,
  };
  const styles = { ...stylesOf(file), [styleId]: definition };
  const document = updateNode(file.document, id, (target) => ({
    ...target,
    styles: { ...styleBindingOf(target as SceneNode), [bindingKey(type)]: styleId },
  }) as SceneNode);
  return { file: { ...file, styles, document }, styleId };
}

function bindingKey(type: StyleType): keyof NodeStyleBinding {
  if (type === 'FILL') return 'fill';
  if (type === 'TEXT') return 'text';
  if (type === 'GRID') return 'grid';
  return 'effect';
}

function defaultStyleName(type: StyleType, file: PigmaFile): string {
  const count = Object.values(stylesOf(file)).filter((style) => style.type === type).length;
  const label = type === 'FILL' ? 'Fill' : type === 'TEXT' ? 'Text' : type === 'GRID' ? 'Grid' : 'Effect';
  return `${label} ${count + 1}`;
}

/** Apply a stored style to the given nodes (payload + binding). */
export function applyStyle(file: PigmaFile, styleId: string, ids: Iterable<string>): PigmaFile {
  const definition = stylesOf(file)[styleId];
  if (!definition) return file;
  let document = file.document;
  for (const id of ids) {
    const node = findNode(document, id);
    if (!node || node.type === 'DOCUMENT' || node.type === 'CANVAS' || node.locked) continue;
    if (definition.type === 'TEXT' && node.type !== 'TEXT') continue;
    const key = bindingKey(definition.type);
    document = updateNode(document, id, (target) => {
      const next = { ...target, styles: { ...styleBindingOf(target as SceneNode), [key]: styleId } } as SceneNode;
      if (definition.paints) next.fills = definition.paints.map((paint) => ({ ...paint }));
      if (definition.effects) next.effects = definition.effects.map((effect) => ({ ...effect }));
      if (definition.text && next.type === 'TEXT') next.style = { ...definition.text };
      return next;
    });
  }
  return document === file.document ? file : { ...file, document };
}

/** Remove the binding from nodes (Figma's "detach style"). */
export function detachStyle(file: PigmaFile, ids: Iterable<string>, type?: StyleType): PigmaFile {
  let document = file.document;
  for (const id of ids) {
    const node = findNode(document, id);
    if (!node || node.type === 'DOCUMENT' || node.type === 'CANVAS') continue;
    const binding = styleBindingOf(node);
    const next: NodeStyleBinding = { ...binding };
    if (type) delete next[bindingKey(type)];
    else {
      delete next.fill;
      delete next.text;
      delete next.effect;
    }
    document = updateNode(document, id, (target) => ({ ...target, styles: next }) as SceneNode);
  }
  return document === file.document ? file : { ...file, document };
}

/** Re-apply the current node payload to every node bound to a style (edit-in-place). */
export function updateStylePayload(file: PigmaFile, styleId: string, id: string): PigmaFile {
  const node = findNode(file.document, id);
  const definition = stylesOf(file)[styleId];
  if (!node || !definition || node.type === 'DOCUMENT' || node.type === 'CANVAS') return file;
  const payload = payloadOf(node, definition.type);
  if (!payload) return file;
  const styles = { ...stylesOf(file), [styleId]: { ...definition, ...payload } };
  const bound = collectBoundNodes(file, styleId);
  return applyStyle({ ...file, styles }, styleId, bound);
}

export function renameStyle(file: PigmaFile, styleId: string, name: string): PigmaFile {
  const definition = stylesOf(file)[styleId];
  if (!definition || name.trim() === '') return file;
  return { ...file, styles: { ...stylesOf(file), [styleId]: { ...definition, name: name.trim() } } };
}

export function deleteStyle(file: PigmaFile, styleId: string): PigmaFile {
  const styles = { ...stylesOf(file) };
  delete styles[styleId];
  return detachStyle({ ...file, styles }, collectBoundNodes(file, styleId));
}

/** Node ids bound to a style. */
export function collectBoundNodes(file: PigmaFile, styleId: string): string[] {
  const ids: string[] = [];
  const visit = (node: SceneNode) => {
    const binding = styleBindingOf(node);
    if (binding.fill === styleId || binding.text === styleId || binding.effect === styleId) ids.push(node.id);
    if ('children' in node && Array.isArray(node.children)) node.children.forEach(visit);
  };
  file.document.children.forEach((page) => (page.children as SceneNode[]).forEach(visit));
  return ids;
}

export function styleSummary(definition: StyleDefinition): string {
  switch (definition.type) {
    case 'FILL': {
      const paint = definition.paints?.[0];
      if (!paint) return 'Fill';
      return paint.type === 'SOLID' ? 'Solid fill' : paint.type.replace('GRADIENT_', '').toLowerCase() + ' gradient';
    }
    case 'TEXT':
      return definition.text ? `${definition.text.fontFamily} ${definition.text.fontSize}` : 'Text';
    case 'EFFECT':
      return (definition.effects ?? []).map((effect) => effect.type.toLowerCase().replace('_', ' ')).join(', ') || 'Effect';
    default:
      return definition.type;
  }
}
