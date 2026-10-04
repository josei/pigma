/**
 * Code Connect mapping tools.
 *
 * Figma's hosted Code Connect tools depend on a codebase and cloud project.
 * Pigma stores mappings in the document metadata (`file.meta.codeConnect`), so
 * `get_code_connect_map` (read) and these writes round-trip through the file.
 * Suggestion/context tools that require analysing a real codebase are not
 * implemented — see `docs/MCP.md`.
 */
import { descendants, findNode } from '../../model/tree';
import { hasChildren, isSceneNode } from '../../model/types';
import type { PigmaFile } from '../../model/types';
import { McpToolError } from '../errors';
import { isRecord, objectArray, optionalString } from '../internal/args';
import { jsonResult, type RegisteredTool } from '../registry';
import { requireFile, requireSnapshot, resolveTargets } from '../session';

interface CodeConnectEntry {
  componentName: string;
  source: string;
  label?: string;
  version?: string;
  snippet?: string;
  snippetImports?: string[];
  snippetNestedFunctions?: string[];
}

function entryFrom(args: Record<string, unknown>): CodeConnectEntry {
  const nodeId = optionalString(args, 'nodeId');
  const componentName = optionalString(args, 'componentName');
  const source = optionalString(args, 'source');
  if (!nodeId || !componentName || !source) {
    throw new McpToolError('Code Connect mappings require `nodeId`, `componentName`, and `source`');
  }
  const entry: CodeConnectEntry = { componentName, source };
  const label = optionalString(args, 'label');
  if (label) entry.label = label;
  const version = optionalString(args, 'version');
  if (version) entry.version = version;
  const snippet = optionalString(args, 'snippet');
  if (snippet) entry.snippet = snippet;
  if (Array.isArray(args.snippetImports)) entry.snippetImports = args.snippetImports.map(String);
  if (Array.isArray(args.snippetNestedFunctions)) entry.snippetNestedFunctions = args.snippetNestedFunctions.map(String);
  return entry;
}

function applyMappings(file: PigmaFile, mappings: Array<{ nodeId: string; entry: CodeConnectEntry }>): PigmaFile {
  const table = isRecord(file.meta?.codeConnect) ? { ...file.meta.codeConnect } : {};
  for (const { nodeId, entry } of mappings) {
    if (!findNode(file.document, nodeId)) throw new McpToolError(`Unknown node id "${nodeId}"`);
    table[nodeId] = entry;
  }
  return { ...file, meta: { ...(file.meta ?? {}), codeConnect: table }, lastModified: Date.now() };
}

const MAPPING_PROPERTIES = {
  nodeId: { type: 'string', description: 'Figma/Pigma node id (an instance or component).' },
  componentName: { type: 'string', description: 'Name of the code component.' },
  source: { type: 'string', description: 'File path or URL of the component.' },
  label: { type: 'string', description: 'Framework label, e.g. "React".' },
  version: { type: 'string', description: 'Source of the mapping, e.g. "Code Connect CLI".' },
  snippet: { type: 'string' },
  snippetImports: { type: 'array', items: { type: 'string' } },
  snippetNestedFunctions: { type: 'array', items: { type: 'string' } },
} as const;

/**
 * Component metadata for generating Code Connect templates: property
 * definitions (with types and variant options) plus the descendant instances
 * and text nodes that carry component property references.
 */
function componentContext(file: PigmaFile, nodeId: string): Record<string, unknown> {
  const node = findNode(file.document, nodeId);
  if (!node || !isSceneNode(node)) throw new McpToolError(`Unknown scene node id "${nodeId}"`);

  let definitions: Record<string, unknown> = {};
  let componentId: string | null = null;
  if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
    definitions = node.componentPropertyDefinitions ?? {};
  } else if (node.type === 'INSTANCE') {
    componentId = node.componentId;
    const component = findNode(file.document, node.componentId);
    if (component && isSceneNode(component) && (component.type === 'COMPONENT' || component.type === 'COMPONENT_SET')) {
      definitions = component.componentPropertyDefinitions ?? {};
    }
  }

  const children: Array<Record<string, unknown>> = [];
  if (hasChildren(node)) {
    for (const child of descendants(node)) {
      if (!isSceneNode(child)) continue;
      const raw = child.raw;
      const references = isRecord(raw) && isRecord(raw.componentPropertyReferences) ? raw.componentPropertyReferences : null;
      if (child.type === 'INSTANCE' || child.type === 'TEXT' || child.type === 'COMPONENT' || references) {
        children.push({
          id: child.id,
          name: child.name,
          type: child.type,
          characters: child.type === 'TEXT' ? child.characters : undefined,
          componentId: child.type === 'INSTANCE' ? child.componentId : undefined,
          propertyReferences: references,
        });
      }
    }
  }

  return { nodeId, name: node.name, type: node.type, componentId, propertyDefinitions: definitions, descendants: children };
}

export const codeConnectTools: RegisteredTool[] = [
  {
    definition: {
      name: 'add_code_connect_map',
      title: 'Add Code Connect map',
      description:
        'Maps a node id to a code component, stored in the document metadata (`file.meta.codeConnect`). ' +
        'Figma\'s hosted tool writes to a cloud project; Pigma persists the mapping in the open file.',
      inputSchema: { type: 'object', properties: { ...MAPPING_PROPERTIES }, required: ['nodeId', 'componentName', 'source'] },
    },
    handler: async (args, ctx) => {
      const { file: current, revision } = await requireSnapshot(ctx.session);
      const file = applyMappings(current, [{ nodeId: optionalString(args, 'nodeId') ?? '', entry: entryFrom(args) }]);
      await ctx.session.setFile(file, { expectedRevision: revision });
      return jsonResult({ map: (file.meta?.codeConnect ?? {}) as Record<string, unknown> });
    },
  },
  {
    definition: {
      name: 'send_code_connect_mappings',
      title: 'Send Code Connect mappings',
      description:
        'Confirms a batch of Code Connect mappings at once (Figma\'s post-suggestion confirmation step), stored in the document metadata.',
      inputSchema: {
        type: 'object',
        properties: {
          mappings: {
            type: 'array',
            items: { type: 'object', properties: { ...MAPPING_PROPERTIES }, required: ['nodeId', 'componentName', 'source'] },
          },
        },
        required: ['mappings'],
      },
    },
    handler: async (args, ctx) => {
      const raw = objectArray(args, 'mappings');
      if (raw.length === 0) throw new McpToolError('`mappings` must contain at least one mapping');
      const mappings = raw.map((item) => ({ nodeId: optionalString(item, 'nodeId') ?? '', entry: entryFrom(item) }));
      const { file: current, revision } = await requireSnapshot(ctx.session);
      const file = applyMappings(current, mappings);
      await ctx.session.setFile(file, { expectedRevision: revision });
      return jsonResult({ confirmed: mappings.length, map: (file.meta?.codeConnect ?? {}) as Record<string, unknown> });
    },
  },
  {
    definition: {
      name: 'get_context_for_code_connect',
      title: 'Get Code Connect context',
      description:
        'Component metadata for Code Connect templates: property definitions (types, variant options) and the descendant instances/text nodes ' +
        'with their component property references. Requires a real component or instance node.',
      inputSchema: {
        type: 'object',
        properties: { nodeId: { type: 'string', description: 'Component, component set, or instance id.' } },
        required: ['nodeId'],
      },
    },
    handler: (args, ctx) => {
      const nodeId = optionalString(args, 'nodeId');
      if (!nodeId) throw new McpToolError('`nodeId` is required');
      return jsonResult(componentContext(requireFile(ctx.session), nodeId));
    },
  },
  {
    definition: {
      name: 'get_code_connect_suggestions',
      title: 'Get Code Connect suggestions',
      description:
        'Lists selected components/instances with their existing Code Connect mapping, component property definitions, and whether a mapping is ' +
        'missing. Pigma has no codebase to analyse, so candidate source paths are NOT fabricated: `source` is null and the caller supplies mappings ' +
        'via `add_code_connect_map`.',
      inputSchema: {
        type: 'object',
        properties: { nodeId: { type: 'string', description: 'Layer id. Omit to use the current selection.' } },
      },
    },
    handler: (args, ctx) => {
      const file = requireFile(ctx.session);
      const nodes = resolveTargets(file, optionalString(args, 'nodeId'), ctx.session.getSelection());
      const table = isRecord(file.meta?.codeConnect) ? file.meta.codeConnect : {};
      const suggestions = nodes.map((node) => {
        const existing = table[node.id];
        const definitions =
          (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET' ? node.componentPropertyDefinitions : undefined) ?? {};
        return {
          nodeId: node.id,
          componentName: node.name,
          type: node.type,
          mapped: existing !== undefined,
          currentMapping: existing ?? null,
          variantOptions: isRecord(definitions)
            ? Object.entries(definitions).flatMap(([name, definition]) =>
                isRecord(definition) && Array.isArray(definition.variantOptions) ? [{ property: name, options: definition.variantOptions }] : [],
              )
            : [],
          source: null,
        };
      });
      return jsonResult({
        suggestions,
        requiresCodebase: true,
        note: 'Pigma cannot inspect a codebase, so no source path is guessed. Confirm mappings with add_code_connect_map or send_code_connect_mappings.',
      });
    },
  },
];
