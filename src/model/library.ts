import type {
  Effect,
  InstanceNode,
  NodeOverride,
  Paint,
  StyleDefinition,
  TextStyle,
  PigmaFile,
  SceneNode,
  StyleType,
  VariableCollection,
  VariableDefinition,
} from './types';
import { hasChildren } from './types';
import { findNode, insertChild, updateNode, walk } from './tree';
import { nextNodeId } from './ids';
import { cloneSubtree } from './ops';
import { applyOverride, instanceChildId } from './instances';

/**
 * Libraries and publishing (M11).
 *
 * Publishing snapshots the components, styles and variables of a file into a
 * self-contained {@link Library}, so other files can insert and refresh copies
 * of them without depending on the source document. Each published file keeps a
 * {@link PigmaFile.publishedLibrary} record whose id survives re-publishes,
 * which is what lets an instance say "this came from library X version N".
 *
 * A library entry holds an *independent* deep clone of the component subtree
 * (node ids preserved so keys and overrides stay stable). Inserting an entry
 * materialises a local COMPONENT with fresh ids plus an INSTANCE that records
 * the library link, so the target file never aliases library state.
 */

export interface LibraryComponentEntry {
  key: string;
  name: string;
  node: SceneNode;
  width: number;
  height: number;
  description?: string;
}

export interface LibraryStyleEntry {
  key: string;
  name: string;
  type: StyleType;
  description?: string;
  /** The style's definition, so importing it into another file keeps its look. */
  payload?: { paints?: Paint[]; text?: TextStyle; effects?: Effect[] };
}

export interface Library {
  id: string;
  name: string;
  sourceFileId: string;
  sourceFileName: string;
  version: number;
  publishedAt: number;
  components: LibraryComponentEntry[];
  styles: LibraryStyleEntry[];
  variables: Record<string, VariableDefinition>;
  variableCollections: Record<string, VariableCollection>;
}

/** Shape of a node carrying an explicit publishing key (not part of BaseNode). */
interface KeyedNode {
  key?: unknown;
}

function explicitComponentKey(node: SceneNode): string | null {
  const candidate = (node as SceneNode & KeyedNode).key ?? node.raw?.key;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

/** Stable component key: an explicit `key` on the node wins, else a deterministic id/name-derived key. */
export function componentKey(node: SceneNode): string {
  const explicit = explicitComponentKey(node);
  if (explicit) return explicit;
  const slug = node.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? `${slug}-${node.id}` : `${node.type.toLowerCase()}-${node.id}`;
}

function componentEntry(node: SceneNode): LibraryComponentEntry {
  const entry: LibraryComponentEntry = {
    key: componentKey(node),
    name: node.name,
    node: structuredClone(node),
    width: node.width,
    height: node.height,
  };
  if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
    if (node.description !== undefined) entry.description = node.description;
  }
  return entry;
}

/**
 * Build a library from the file's components/styles/variables and record the
 * publication on the file (`file.publishedLibrary`). Re-publishing with the same
 * libraryId (or the same sourceFileId) increments `version` and preserves the id;
 * a caller-supplied `version` overrides that.
 */
export function publishLibrary(
  file: PigmaFile,
  options?: { libraryId?: string | null; name?: string; now?: () => number; version?: number },
): { library: Library; file: PigmaFile } {
  const components: LibraryComponentEntry[] = [];
  walk(file.document, (node) => {
    if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') components.push(componentEntry(node));
  });

  const styles: LibraryStyleEntry[] = Object.entries(file.styles ?? {}).map(([id, definition]) => {
    const entry: LibraryStyleEntry = {
      key: definition.key ?? id,
      name: definition.name,
      type: definition.type,
    };
    if (definition.description !== undefined) entry.description = definition.description;
    const payload: LibraryStyleEntry['payload'] = {};
    if (definition.paints) payload.paints = structuredClone(definition.paints);
    if (definition.text) payload.text = structuredClone(definition.text);
    if (definition.effects) payload.effects = structuredClone(definition.effects);
    if (Object.keys(payload).length > 0) entry.payload = payload;
    return entry;
  });

  const previous = file.publishedLibrary;
  const id = options?.libraryId ?? previous?.id ?? nextNodeId();
  const republishing = previous !== undefined && previous.id === id;
  const version = options?.version ?? (republishing ? previous.version + 1 : 1);
  const name = options?.name ?? previous?.name ?? file.name;
  const publishedAt = (options?.now ?? Date.now)();

  const library: Library = {
    id,
    name,
    sourceFileId: file.document.id,
    sourceFileName: file.name,
    version,
    publishedAt,
    components,
    styles,
    variables: structuredClone(file.variables ?? {}),
    variableCollections: structuredClone(file.variableCollections ?? {}),
  };

  return {
    library,
    file: { ...file, publishedLibrary: { id, name, version, publishedAt } },
  };
}

/** Insert or replace a library by id, newest last. */
export function upsertLibrary(libraries: Library[], library: Library): Library[] {
  return [...libraries.filter((entry) => entry.id !== library.id), library];
}

export function libraryComponent(library: Library, key: string): LibraryComponentEntry | null {
  return library.components.find((entry) => entry.key === key) ?? null;
}

/**
 * Materialise a component's children for an instance: ids are derived from the
 * instance id and the *component* node id (`<instanceId>~<componentNodeId>`), so
 * overrides — keyed by component node id — stay valid across library updates.
 */
function materializeChildren(
  instanceId: string,
  component: SceneNode,
  overrides: Record<string, NodeOverride>,
): SceneNode[] {
  if (!hasChildren(component)) return [];
  const build = (node: SceneNode): SceneNode => {
    const copy = { ...node, id: instanceChildId(instanceId, node.id) } as SceneNode;
    const withOverride = applyOverride(copy, overrides[node.id]);
    if (!hasChildren(node)) return withOverride;
    const children = (node.children as SceneNode[]).map(build);
    return { ...(withOverride as typeof node), children };
  };
  return (component.children as SceneNode[]).map(build);
}

/**
 * Insert a library component into `file` as an INSTANCE: materialise the component
 * into the target parent as a COMPONENT node (deep clone with fresh ids for the
 * local copy, keeping children intact), then insert an INSTANCE that points at it
 * and records libraryId/libraryKey/libraryVersion. Returns the new file plus the
 * instance and component ids (null when the library/key/parent is missing).
 */
export function instantiateFromLibrary(
  file: PigmaFile,
  library: Library,
  key: string,
  options: { parentId: string; x: number; y: number; id?: string },
): { file: PigmaFile; instanceId: string | null; componentId: string | null } {
  const entry = libraryComponent(library, key);
  const parent = findNode(file.document, options.parentId);
  if (!entry || !parent || parent.type === 'DOCUMENT' || !hasChildren(parent)) {
    return { file, instanceId: null, componentId: null };
  }

  const { node: component } = cloneSubtree(entry.node);
  component.transform = { ...component.transform, tx: options.x, ty: options.y };

  const instanceId = options.id ?? nextNodeId();
  const instance: InstanceNode = {
    id: instanceId,
    name: entry.name,
    type: 'INSTANCE',
    visible: true,
    locked: false,
    opacity: 1,
    transform: { a: 1, b: 0, c: 0, d: 1, tx: options.x, ty: options.y },
    width: entry.node.width,
    height: entry.node.height,
    fills: [...entry.node.fills],
    strokes: [...entry.node.strokes],
    children: materializeChildren(instanceId, entry.node, {}),
    componentId: component.id,
    libraryId: library.id,
    libraryKey: key,
    libraryVersion: library.version,
    componentSnapshot: structuredClone(component),
  };

  let document = insertChild(file.document, options.parentId, component);
  document = insertChild(document, options.parentId, instance);
  return { file: { ...file, document }, instanceId, componentId: component.id };
}

/** Library link recorded on an instance, or null. */
export function libraryLinkOf(
  node: SceneNode,
): { libraryId: string; libraryKey: string; libraryVersion: number } | null {
  if (node.type !== 'INSTANCE') return null;
  const { libraryId, libraryKey, libraryVersion } = node;
  if (!libraryId || !libraryKey || libraryVersion === undefined) return null;
  return { libraryId, libraryKey, libraryVersion };
}

/** An instance whose recorded library version is behind the published library. */
interface StaleLibraryInstance {
  instanceId: string;
  name: string;
  libraryId: string;
  libraryKey: string;
  publishedVersion: number;
  currentVersion: number;
}

/** Instances whose libraryVersion is behind the library's current version. */
export function staleLibraryInstances(file: PigmaFile, libraries: Library[]): StaleLibraryInstance[] {
  const byId = new Map(libraries.map((library) => [library.id, library]));
  const stale: StaleLibraryInstance[] = [];

  walk(file.document, (node) => {
    if (node.type !== 'INSTANCE') return;
    const link = libraryLinkOf(node);
    if (!link) return;
    const library = byId.get(link.libraryId);
    if (!library || !libraryComponent(library, link.libraryKey)) return;
    const publishedVersion = link.libraryVersion ?? 0;
    if (publishedVersion >= library.version) return;
    stale.push({
      instanceId: node.id,
      name: node.name,
      libraryId: link.libraryId,
      libraryKey: link.libraryKey,
      publishedVersion,
      currentVersion: library.version,
    });
  });

  return stale;
}

/**
 * The library a component node belongs to, when it is published anywhere: the
 * link an instance of that component should carry. A component published in more
 * than one library links to the newest publication.
 */
export function libraryLinkForComponent(
  libraries: Library[],
  componentId: string,
): { libraryId: string; libraryKey: string; libraryVersion: number } | null {
  let best: { libraryId: string; libraryKey: string; libraryVersion: number } | null = null;
  for (const library of libraries) {
    for (const entry of library.components) {
      if (entry.node.id !== componentId) continue;
      if (!best || library.version > best.libraryVersion) {
        best = { libraryId: library.id, libraryKey: entry.key, libraryVersion: library.version };
      }
    }
  }
  return best;
}

/**
 * Refresh every instance linked to `library` from the library's current component:
 * replace the instance's children/size/transform with a fresh materialisation while
 * keeping the instance's own id, position (transform tx/ty), name and overrides, and
 * bumping libraryVersion to the library version.
 */
export function updateInstancesFromLibrary(
  file: PigmaFile,
  library: Library,
  options: { instanceId?: string } = {},
): { file: PigmaFile; updated: number } {
  const ids: string[] = [];
  walk(file.document, (node) => {
    if (node.type !== 'INSTANCE') return;
    if (options.instanceId !== undefined && node.id !== options.instanceId) return;
    // Same link test as `staleLibraryInstances`, so "stale" and "updatable" agree.
    const link = libraryLinkOf(node);
    if (!link || link.libraryId !== library.id) return;
    if (libraryComponent(library, link.libraryKey)) ids.push(node.id);
  });
  if (ids.length === 0) return { file, updated: 0 };

  let document = file.document;
  let updated = 0;
  for (const id of ids) {
    const current = findNode(document, id);
    if (!current || current.type !== 'INSTANCE') continue;
    const entry = libraryComponent(library, current.libraryKey ?? '');
    if (!entry) continue;

    const component = entry.node;
    const children = materializeChildren(id, component, current.overrides ?? {});
    document = updateNode(document, id, (node) => {
      const instance = node as InstanceNode;
      return {
        ...instance,
        // The instance's own shape follows the published component: a rectangle
        // instance *is* the rectangle, so its fill, stroke and radius come from
        // the master. Position, name and per-layer overrides stay the instance's.
        width: component.width,
        height: component.height,
        fills: component.fills.map((fill) => ({ ...fill })),
        strokes: component.strokes.map((stroke) => ({ ...stroke })),
        ...(component.strokeWeight === undefined ? {} : { strokeWeight: component.strokeWeight }),
        ...(component.cornerRadius === undefined ? {} : { cornerRadius: component.cornerRadius }),
        opacity: component.opacity,
        ...(component.effects === undefined ? {} : { effects: structuredClone(component.effects) }),
        transform: {
          a: component.transform.a,
          b: component.transform.b,
          c: component.transform.c,
          d: component.transform.d,
          tx: instance.transform.tx,
          ty: instance.transform.ty,
        },
        children,
        componentSnapshot: structuredClone(component),
        libraryVersion: library.version,
      };
    });
    updated += 1;
  }

  return { file: { ...file, document }, updated };
}

/**
 * Copy a published style into `file`. A style with the same key is reused, so
 * importing twice is idempotent. Returns the local style id.
 */
export function importLibraryStyle(
  file: PigmaFile,
  library: Library,
  styleKey: string,
): { file: PigmaFile; styleId: string | null } {
  const entry = library.styles.find((style) => style.key === styleKey);
  if (!entry) return { file, styleId: null };
  const existing = Object.entries(file.styles ?? {}).find(([, definition]) => definition.key === styleKey);
  if (existing) return { file, styleId: existing[0] };

  const styleId = nextNodeId();
  const definition: StyleDefinition = {
    key: entry.key,
    name: entry.name,
    type: entry.type,
    ...(entry.description !== undefined ? { description: entry.description } : {}),
    ...(entry.payload?.paints ? { paints: structuredClone(entry.payload.paints) } : {}),
    ...(entry.payload?.text ? { text: structuredClone(entry.payload.text) } : {}),
    ...(entry.payload?.effects ? { effects: structuredClone(entry.payload.effects) } : {}),
  };
  return {
    file: { ...file, styles: { ...(file.styles ?? {}), [styleId]: definition } },
    styleId,
  };
}

/**
 * Copy a library's variable collections and variables into `file` with fresh ids
 * (collection ids, mode ids and variable ids are remapped consistently, and the
 * imported collection becomes the active mode). A collection with the same name is
 * reused, so importing twice does not duplicate.
 */
export function importLibraryVariables(file: PigmaFile, library: Library): { file: PigmaFile; imported: number } {
  const sourceCollections = Object.values(library.variableCollections);
  const sourceVariables = Object.values(library.variables);
  if (sourceCollections.length === 0 && sourceVariables.length === 0) return { file, imported: 0 };

  const collections = { ...(file.variableCollections ?? {}) };
  const variables = { ...(file.variables ?? {}) };
  const activeModes = { ...(file.activeModes ?? {}) };
  const collectionIdMap = new Map<string, string>();
  const modeIdMap = new Map<string, Map<string, string>>();
  let imported = 0;

  for (const source of sourceCollections) {
    const reusable = Object.values(collections).find((collection) => collection.name === source.name);
    if (reusable) {
      collectionIdMap.set(source.id, reusable.id);
      const modes = new Map<string, string>();
      for (const mode of source.modes) {
        const match = reusable.modes.find((candidate) => candidate.name === mode.name);
        if (match) modes.set(mode.modeId, match.modeId);
      }
      modeIdMap.set(source.id, modes);
      continue;
    }
    const id = nextNodeId();
    const modes = new Map<string, string>();
    const collectionModes = source.modes.map((mode) => {
      const modeId = nextNodeId();
      modes.set(mode.modeId, modeId);
      return { modeId, name: mode.name };
    });
    collectionIdMap.set(source.id, id);
    modeIdMap.set(source.id, modes);
    collections[id] = {
      id,
      name: source.name,
      modes: collectionModes,
      defaultModeId: modes.get(source.defaultModeId) ?? collectionModes[0]?.modeId ?? '',
      variableIds: [],
    };
    if (collections[id]!.defaultModeId) activeModes[id] = collections[id]!.defaultModeId;
  }

  for (const source of sourceVariables) {
    if (Object.values(variables).some((variable) => variable.name === source.name)) continue;
    const localCollectionId = collectionIdMap.get(source.variableCollectionId);
    if (!localCollectionId) continue;
    const modes = modeIdMap.get(source.variableCollectionId) ?? new Map<string, string>();
    const valuesByMode: Record<string, VariableDefinition['valuesByMode'][string]> = {};
    for (const [modeId, value] of Object.entries(source.valuesByMode)) {
      const localMode = modes.get(modeId);
      if (localMode) valuesByMode[localMode] = structuredClone(value);
    }
    const id = nextNodeId();
    variables[id] = {
      id,
      name: source.name,
      resolvedType: source.resolvedType,
      variableCollectionId: localCollectionId,
      valuesByMode,
      ...(source.description !== undefined ? { description: source.description } : {}),
    };
    const collection = collections[localCollectionId]!;
    collections[localCollectionId] = { ...collection, variableIds: [...collection.variableIds, id] };
    imported += 1;
  }

  return { file: { ...file, variableCollections: collections, variables, activeModes }, imported };
}
