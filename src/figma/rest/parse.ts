/**
 * Parser + validator for Figma REST API responses.
 *
 * Accepts either a full-file response (`GET /v1/files/:key`, with a `document`
 * tree) or a nodes response (`GET /v1/files/:key/nodes?ids=…`, with detached
 * subtrees keyed by id). The original objects are retained verbatim — nothing
 * is copied, renamed, or dropped — and a validated `id → node` index plus the
 * root list are derived for the converter.
 */
import { FigmaImportError } from '../errors';
import { asRecord, optionalNumber, optionalString, requireString } from '../internal/json';
import type {
  FigmaComponent,
  FigmaRestFile,
  FigmaRestNode,
  FigmaRestNodesResponse,
  FigmaStyle,
} from './types';

export interface RestParseOptions {
  /** File key the response came from, when known. */
  fileKey?: string;
}

type NodeFrame =
  | { kind: 'enter'; node: unknown; path: string }
  | { kind: 'exit'; id: string };

/**
 * Walk the tree iteratively (no recursion-depth limit), validating ids/types and
 * rejecting duplicate ids and cycles.
 */
function collectNodes(roots: unknown[], nodeMap: Map<string, FigmaRestNode>): void {
  const onStack = new Set<string>();
  const visited = new Set<string>();
  const stack: NodeFrame[] = [];

  for (let i = roots.length - 1; i >= 0; i--) {
    stack.push({ kind: 'enter', node: roots[i], path: `roots[${i}]` });
  }

  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) break;
    if (frame.kind === 'exit') {
      onStack.delete(frame.id);
      continue;
    }

    const record = asRecord(frame.node, frame.path);
    const id = requireString(record, 'id', frame.path);
    requireString(record, 'type', frame.path);

    if (onStack.has(id)) {
      throw new FigmaImportError('CYCLE', `Node ${id} appears inside its own descendant chain`, { path: frame.path });
    }
    if (visited.has(id)) {
      throw new FigmaImportError('DUPLICATE_ID', `Node id ${id} appears more than once`, { path: frame.path });
    }
    visited.add(id);
    onStack.add(id);
    nodeMap.set(id, frame.node as FigmaRestNode);

    const children = record.children;
    if (children !== undefined) {
      if (!Array.isArray(children)) {
        throw new FigmaImportError('INVALID_DOCUMENT', `\`children\` must be an array at ${frame.path}`, {
          path: `${frame.path}.children`,
        });
      }
      stack.push({ kind: 'exit', id });
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push({ kind: 'enter', node: children[i], path: `${frame.path}.children[${i}]` });
      }
    }
  }
}

function mergeResources<T>(target: Record<string, T>, source: unknown, path: string): void {
  if (source === undefined) return;
  const record = asRecord(source, path);
  for (const [key, value] of Object.entries(record)) target[key] = value as T;
}

function fileEnvelope(root: Record<string, unknown>, options: RestParseOptions): Omit<FigmaRestFile, 'roots' | 'nodeMap' | 'components' | 'componentSets' | 'styles' | 'raw'> {
  return {
    kind: 'rest',
    fileKey: options.fileKey ?? optionalString(root, 'mainFileKey'),
    name: optionalString(root, 'name') ?? 'Untitled',
    role: optionalString(root, 'role'),
    lastModified: optionalString(root, 'lastModified'),
    editorType: optionalString(root, 'editorType'),
    thumbnailUrl: optionalString(root, 'thumbnailUrl'),
    version: optionalString(root, 'version'),
    schemaVersion: optionalNumber(root, 'schemaVersion'),
  };
}

/** Parse a `GET /v1/files/:key` response. */
export function parseFigmaRestFile(input: unknown, options: RestParseOptions = {}): FigmaRestFile {
  const root = asRecord(input, 'response');
  const document = asRecord(root.document, 'response.document');

  const nodeMap = new Map<string, FigmaRestNode>();
  collectNodes([document], nodeMap);

  const components: Record<string, FigmaComponent> = {};
  const componentSets: Record<string, FigmaComponent> = {};
  const styles: Record<string, FigmaStyle> = {};
  mergeResources(components, root.components, 'response.components');
  mergeResources(componentSets, root.componentSets, 'response.componentSets');
  mergeResources(styles, root.styles, 'response.styles');

  // collectNodes validated the whole subtree, so the cast is sound.
  return {
    ...fileEnvelope(root, options),
    roots: [document as FigmaRestNode],
    nodeMap,
    components,
    componentSets,
    styles,
    // Some responses (and all callers that fetched `/variables/local`) attach the
    // variable tables; they are carried through verbatim for the converter.
    ...(root.variableCollections !== undefined || root.variables !== undefined
      ? { variables: { variableCollections: root.variableCollections, variables: root.variables } }
      : {}),
    raw: input,
  };
}

/** Parse a `GET /v1/files/:key/nodes?ids=…` response. */
export function parseFigmaRestNodes(input: unknown, options: RestParseOptions = {}): FigmaRestFile {
  const root = asRecord(input, 'response');
  const nodes = asRecord(root.nodes, 'response.nodes');
  if (Object.keys(nodes).length === 0) {
    throw new FigmaImportError('INVALID_DOCUMENT', 'Nodes response contains no entries', { path: 'response.nodes' });
  }

  const components: Record<string, FigmaComponent> = {};
  const componentSets: Record<string, FigmaComponent> = {};
  const styles: Record<string, FigmaStyle> = {};
  const roots: unknown[] = [];

  for (const [key, entry] of Object.entries(nodes)) {
    const record = asRecord(entry, `response.nodes.${key}`);
    roots.push(asRecord(record.document, `response.nodes.${key}.document`));
    mergeResources(components, record.components, `response.nodes.${key}.components`);
    mergeResources(componentSets, record.componentSets, `response.nodes.${key}.componentSets`);
    mergeResources(styles, record.styles, `response.nodes.${key}.styles`);
  }

  const nodeMap = new Map<string, FigmaRestNode>();
  collectNodes(roots, nodeMap);

  // collectNodes validated every subtree, so the cast is sound.
  return {
    ...fileEnvelope(root, options),
    roots: roots as FigmaRestNode[],
    nodeMap,
    components,
    componentSets,
    styles,
    raw: input,
  };
}

/** Parse either REST response shape, detecting it from the top-level fields. */
export function parseFigmaRest(input: unknown, options: RestParseOptions = {}): FigmaRestFile {
  const root = asRecord(input, 'response');
  if (root.document !== undefined) return parseFigmaRestFile(input, options);
  if (root.nodes !== undefined) return parseFigmaRestNodes(input, options);
  throw new FigmaImportError(
    'INVALID_INPUT',
    'Unrecognized Figma response: expected a `document` (files) or `nodes` (nodes) field',
  );
}

/** Depth-first walk over a REST subtree, root first. */
export function walkFigmaRest(root: FigmaRestNode, visit: (node: FigmaRestNode) => void): void {
  const stack: FigmaRestNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) break;
    visit(node);
    const children = node.children;
    if (Array.isArray(children)) {
      for (let i = children.length - 1; i >= 0; i--) {
        const child = children[i];
        if (child) stack.push(child);
      }
    }
  }
}

export type { FigmaRestNodesResponse };
