import type { Node, PigmaFile, RGBA, SceneNode, VariableCollection, VariableDefinition } from './types';
import { findNode, updateNode } from './tree';
import { nextNodeId } from './ids';

/**
 * Variables and modes (M11).
 *
 * Figma-shaped: a file owns collections (each with named modes) and variables
 * (each with a value per mode). Nodes bind a property to a variable through
 * `node.boundVariables = { fill: '<varId>', opacity: '<varId>' }`, and rendering
 * resolves the binding against the collection's *active* mode, so switching a
 * mode repaints the canvas without touching any node.
 *
 * Supported bindings: fill/stroke (COLOR), opacity/cornerRadius (FLOAT),
 * visible (BOOLEAN), characters (STRING).
 */

export type VariableType = VariableDefinition['resolvedType'];

export const VARIABLE_TYPES: VariableType[] = ['COLOR', 'FLOAT', 'STRING', 'BOOLEAN'];

/** Property -> variable type that may drive it. */
export const BINDABLE_PROPERTIES: Record<string, VariableType> = {
  fill: 'COLOR',
  stroke: 'COLOR',
  opacity: 'FLOAT',
  cornerRadius: 'FLOAT',
  visible: 'BOOLEAN',
  characters: 'STRING',
};

export function collectionsOf(file: PigmaFile): Record<string, VariableCollection> {
  return (file.variableCollections ?? {}) as Record<string, VariableCollection>;
}

export function variablesOf(file: PigmaFile): Record<string, VariableDefinition> {
  return (file.variables ?? {}) as Record<string, VariableDefinition>;
}

export function activeModeOf(file: PigmaFile, collectionId: string): string | null {
  const collection = collectionsOf(file)[collectionId];
  if (!collection) return null;
  const active = (file.activeModes ?? {})[collectionId];
  if (active && collection.modes.some((mode) => mode.modeId === active)) return active;
  return collection.defaultModeId ?? collection.modes[0]?.modeId ?? null;
}

export function defaultVariableValue(type: VariableType): VariableDefinition['valuesByMode'][string] {
  switch (type) {
    case 'COLOR':
      return { r: 0.2, g: 0.4, b: 1, a: 1 };
    case 'FLOAT':
      return 1;
    case 'BOOLEAN':
      return true;
    case 'STRING':
    default:
      return '';
  }
}

/** Create a collection with a single "Mode 1" mode. */
export function createCollection(file: PigmaFile, name: string): { file: PigmaFile; collectionId: string } {
  const collectionId = nextNodeId();
  const modeId = `${collectionId}:mode:1`;
  const collection: VariableCollection = {
    id: collectionId,
    name: name.trim() || `Collection ${Object.keys(collectionsOf(file)).length + 1}`,
    modes: [{ modeId, name: 'Mode 1' }],
    defaultModeId: modeId,
    variableIds: [],
  };
  return {
    file: {
      ...file,
      variableCollections: { ...collectionsOf(file), [collectionId]: collection },
      activeModes: { ...(file.activeModes ?? {}), [collectionId]: modeId },
    },
    collectionId,
  };
}

export function addVariable(
  file: PigmaFile,
  collectionId: string,
  type: VariableType,
  name?: string,
): { file: PigmaFile; variableId: string | null } {
  const collection = collectionsOf(file)[collectionId];
  if (!collection) return { file, variableId: null };
  const variableId = nextNodeId();
  const valuesByMode: Record<string, VariableDefinition['valuesByMode'][string]> = {};
  for (const mode of collection.modes) valuesByMode[mode.modeId] = defaultVariableValue(type);
  const definition: VariableDefinition = {
    id: variableId,
    name: name ?? `${type.toLowerCase()} ${collection.variableIds.length + 1}`,
    resolvedType: type,
    variableCollectionId: collectionId,
    valuesByMode,
  };
  return {
    file: {
      ...file,
      variables: { ...variablesOf(file), [variableId]: definition },
      variableCollections: {
        ...collectionsOf(file),
        [collectionId]: { ...collection, variableIds: [...collection.variableIds, variableId] },
      },
    },
    variableId,
  };
}

export function setVariableValue(
  file: PigmaFile,
  variableId: string,
  modeId: string,
  value: VariableDefinition['valuesByMode'][string],
): PigmaFile {
  const definition = variablesOf(file)[variableId];
  if (!definition) return file;
  return {
    ...file,
    variables: {
      ...variablesOf(file),
      [variableId]: { ...definition, valuesByMode: { ...definition.valuesByMode, [modeId]: value } },
    },
  };
}

export function renameVariable(file: PigmaFile, variableId: string, name: string): PigmaFile {
  const definition = variablesOf(file)[variableId];
  if (!definition || name.trim() === '') return file;
  return { ...file, variables: { ...variablesOf(file), [variableId]: { ...definition, name: name.trim() } } };
}

export function addMode(file: PigmaFile, collectionId: string, name?: string): PigmaFile {
  const collection = collectionsOf(file)[collectionId];
  if (!collection) return file;
  const modeId = `${collectionId}:mode:${collection.modes.length + 1}`;
  const mode = { modeId, name: name?.trim() || `Mode ${collection.modes.length + 1}` };
  const variables = { ...variablesOf(file) };
  for (const id of collection.variableIds) {
    const definition = variables[id];
    if (!definition) continue;
    const fallback = activeModeOf(file, collectionId);
    variables[id] = {
      ...definition,
      valuesByMode: { ...definition.valuesByMode, [modeId]: definition.valuesByMode[fallback ?? ''] ?? defaultVariableValue(definition.resolvedType) },
    };
  }
  return {
    ...file,
    variables,
    variableCollections: { ...collectionsOf(file), [collectionId]: { ...collection, modes: [...collection.modes, mode] } },
  };
}

export function setActiveMode(file: PigmaFile, collectionId: string, modeId: string): PigmaFile {
  const collection = collectionsOf(file)[collectionId];
  if (!collection || !collection.modes.some((mode) => mode.modeId === modeId)) return file;
  return { ...file, activeModes: { ...(file.activeModes ?? {}), [collectionId]: modeId } };
}

export function deleteVariable(file: PigmaFile, variableId: string): PigmaFile {
  const definition = variablesOf(file)[variableId];
  if (!definition) return file;
  const variables = { ...variablesOf(file) };
  delete variables[variableId];
  const collection = collectionsOf(file)[definition.variableCollectionId];
  const collections = { ...collectionsOf(file) };
  if (collection) {
    collections[collection.id] = { ...collection, variableIds: collection.variableIds.filter((id) => id !== variableId) };
  }
  return { ...file, variables, variableCollections: collections, document: unbindEverywhere(file, variableId) };
}

function unbindEverywhere(file: PigmaFile, variableId: string): PigmaFile['document'] {
  const strip = (node: SceneNode): SceneNode => {
    const bindings = bindingsOf(node);
    const entries = Object.entries(bindings).filter(([, value]) => value !== variableId);
    const next = { ...node, boundVariables: Object.fromEntries(entries) } as SceneNode;
    if ('children' in node && Array.isArray(node.children)) {
      (next as { children: SceneNode[] }).children = (node.children as SceneNode[]).map(strip);
    }
    return next;
  };
  return { ...file.document, children: file.document.children.map((page) => ({ ...page, children: (page.children as SceneNode[]).map(strip) })) };
}

export function bindingsOf(node: Node): Record<string, string> {
  if (node.type === 'DOCUMENT' || node.type === 'CANVAS') return {};
  return (node.boundVariables ?? {}) as Record<string, string>;
}

export function bindVariable(file: PigmaFile, nodeId: string, property: string, variableId: string | null): PigmaFile {
  const node = findNode(file.document, nodeId);
  if (!node || node.type === 'DOCUMENT' || node.type === 'CANVAS') return file;
  const bindings = { ...bindingsOf(node) };
  if (variableId) bindings[property] = variableId;
  else delete bindings[property];
  return { ...file, document: updateNode(file.document, nodeId, (target) => ({ ...target, boundVariables: bindings }) as SceneNode) };
}

/** Variables that may drive `property`, with their resolved value for the active mode. */
export function bindableVariables(file: PigmaFile, property: string): Array<{ id: string; name: string; value: unknown }> {
  const wanted = BINDABLE_PROPERTIES[property];
  if (!wanted) return [];
  return Object.values(variablesOf(file))
    .filter((definition) => definition.resolvedType === wanted)
    .map((definition) => ({ id: definition.id, name: definition.name, value: resolveVariable(file, definition.id) }));
}

export function resolveVariable(file: PigmaFile, variableId: string): VariableDefinition['valuesByMode'][string] | null {
  const definition = variablesOf(file)[variableId];
  if (!definition) return null;
  const mode = activeModeOf(file, definition.variableCollectionId);
  if (!mode) return null;
  const value = definition.valuesByMode[mode];
  return value === undefined ? null : value;
}

function colorValue(value: unknown): RGBA | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<RGBA>;
  if (typeof record.r !== 'number' || typeof record.g !== 'number' || typeof record.b !== 'number') return null;
  return { r: record.r, g: record.g, b: record.b, ...(typeof record.a === 'number' ? { a: record.a } : {}) };
}

/**
 * Effective values for a node after resolving its variable bindings against the
 * active modes. Returns null when the node has no bindings, so the renderer can
 * skip the copy entirely.
 */
export function resolveNodeVariables(
  file: PigmaFile,
  node: SceneNode,
): { fills?: SceneNode['fills']; strokes?: SceneNode['strokes']; opacity?: number; visible?: boolean; cornerRadius?: number; characters?: string } | null {
  const bindings = bindingsOf(node);
  const keys = Object.keys(bindings);
  if (keys.length === 0) return null;
  const out: { fills?: SceneNode['fills']; strokes?: SceneNode['strokes']; opacity?: number; visible?: boolean; cornerRadius?: number; characters?: string } = {};

  for (const property of keys) {
    const variableId = bindings[property];
    if (!variableId) continue;
    const value = resolveVariable(file, variableId);
    if (value === null) continue;
    switch (property) {
      case 'fill': {
        const color = colorValue(value);
        if (color) out.fills = [{ type: 'SOLID', color: { r: color.r, g: color.g, b: color.b }, opacity: color.a ?? 1 }];
        break;
      }
      case 'stroke': {
        const color = colorValue(value);
        if (color) out.strokes = [{ type: 'SOLID', color: { r: color.r, g: color.g, b: color.b }, opacity: color.a ?? 1 }];
        break;
      }
      case 'opacity':
        if (typeof value === 'number') out.opacity = Math.min(1, Math.max(0, value));
        break;
      case 'cornerRadius':
        if (typeof value === 'number') out.cornerRadius = Math.max(0, value);
        break;
      case 'visible':
        if (typeof value === 'boolean') out.visible = value;
        break;
      case 'characters':
        if (typeof value === 'string') out.characters = value;
        break;
      default:
        break;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}
