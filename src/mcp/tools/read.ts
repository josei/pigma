/**
 * Read tools: the Figma MCP "design to code" and "design systems" read surface,
 * implemented against the Pigma document model.
 *
 * Tool names, arguments, and result shapes follow Figma's documented catalog
 * (https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/).
 * Where Pigma cannot match Figma's hosted behavior, the difference is stated in
 * the tool description and in `docs/MCP.md` — never silently approximated.
 */
import { bytesToBase64 } from '../../figma/internal/base64';
import { renderSvgDocument } from '../../render/svgExport';
import type { ContainerNode, PigmaFile, SceneNode } from '../../model/types';
import { hasChildren } from '../../model/types';
import { absoluteBounds, descendants } from '../../model/tree';
import { stylesOf, styleBindingOf } from '../../model/styles';
import { activeModeOf, bindingsOf, collectionsOf, resolveVariable, variablesOf } from '../../model/variables';
import { McpToolError } from '../errors';
import { isRecord, optionalBoolean, optionalNumber, optionalString, stringArray } from '../internal/args';
import { generateDesignCode } from '../codegen';
import { jsonResult, textResult, type RegisteredTool } from '../registry';
import { pageList, requireFile, resolveTargets } from '../session';
import { designContext, metadataXml, nodeInventory } from '../serialize';

function selectionBounds(file: PigmaFile, nodes: SceneNode[]): { width: number; height: number } {
  let width = 0;
  let height = 0;
  for (const node of nodes) {
    const bounds = absoluteBounds(file.document, node.id);
    if (bounds) {
      width = Math.max(width, bounds.width);
      height = Math.max(height, bounds.height);
    }
  }
  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
}

interface CollectedVariable {
  id: string;
  name: string | null;
  resolvedType: string | null;
  collection: string | null;
  /** Value under the file's active mode. */
  value: unknown;
  valuesByMode: Record<string, unknown>;
  usedBy: string[];
}

interface CollectedStyle {
  id: string;
  key: string | null;
  name: string | null;
  styleType: string | null;
  usedBy: string[];
}

/** Components and component sets in the document tree. */
function collectComponents(file: PigmaFile): { components: SceneNode[]; componentSets: SceneNode[] } {
  const components: SceneNode[] = [];
  const componentSets: SceneNode[] = [];
  for (const node of descendants(file.document)) {
    if (node.type === 'COMPONENT') components.push(node as SceneNode);
    else if (node.type === 'COMPONENT_SET') componentSets.push(node as SceneNode);
  }
  return { components, componentSets };
}

/**
 * Variables and styles used by the given nodes, read from the model's
 * first-class `boundVariables` / `styles` fields and from the raw Figma
 * metadata preserved on imported nodes. Values resolve against the file's
 * variable table and active mode, and styles against the file styles table.
 */
function collectVariables(file: PigmaFile, nodes: SceneNode[]): { variables: CollectedVariable[]; styles: CollectedStyle[] } {
  const variableUse = new Map<string, Set<string>>();
  const styleUse = new Map<string, Set<string>>();

  const noteAlias = (map: Map<string, Set<string>>, id: string, nodeId: string): void => {
    const set = map.get(id);
    if (set) set.add(nodeId);
    else map.set(id, new Set([nodeId]));
  };

  const visit = (node: SceneNode): void => {
    // Model bindings: variable ids by property name, style ids by property.
    for (const variableId of Object.values(bindingsOf(node))) {
      if (typeof variableId === 'string') noteAlias(variableUse, variableId, node.id);
    }
    for (const styleId of Object.values(styleBindingOf(node))) {
      if (typeof styleId === 'string') noteAlias(styleUse, styleId, node.id);
    }

    // Raw Figma bindings on imported nodes (REST aliases are `{ id }` objects).
    const raw = node.raw;
    if (isRecord(raw)) {
      const bound = raw.boundVariables;
      if (isRecord(bound)) {
        for (const value of Object.values(bound)) {
          if (isRecord(value) && typeof value.id === 'string') noteAlias(variableUse, value.id, node.id);
          if (Array.isArray(value)) {
            for (const item of value) if (isRecord(item) && typeof item.id === 'string') noteAlias(variableUse, item.id, node.id);
          }
        }
      }
      const nodeStyles = raw.styles;
      if (isRecord(nodeStyles)) {
        for (const value of Object.values(nodeStyles)) if (typeof value === 'string') noteAlias(styleUse, value, node.id);
      }
    }

    if (hasChildren(node)) for (const child of (node as ContainerNode).children) visit(child);
  };
  for (const node of nodes) visit(node);

  const metaStyles = isRecord(file.meta?.styles) ? file.meta.styles : {};
  const variables = variablesOf(file);
  const collections = collectionsOf(file);
  const styles = stylesOf(file);
  return {
    variables: [...variableUse.entries()].map(([id, usedBy]) => {
      const variable = variables[id];
      return {
        id,
        name: variable?.name ?? null,
        resolvedType: variable?.resolvedType ?? null,
        collection: variable ? collections[variable.variableCollectionId]?.name ?? null : null,
        value: resolveVariable(file, id),
        valuesByMode: variable?.valuesByMode ?? {},
        usedBy: [...usedBy],
      };
    }),
    styles: [...styleUse.entries()].map(([id, usedBy]) => {
      const style = styles[id];
      const meta = metaStyles[id];
      return {
        id,
        key: style?.key ?? (isRecord(meta) && typeof meta.key === 'string' ? meta.key : null),
        name: style?.name ?? (isRecord(meta) && typeof meta.name === 'string' ? meta.name : null),
        styleType: style?.type ?? (isRecord(meta) && typeof meta.styleType === 'string' ? meta.styleType : null),
        usedBy: [...usedBy],
      };
    }),
  };
}

export const readTools: RegisteredTool[] = [
  {
    definition: {
      name: 'get_metadata',
      title: 'Get metadata',
      description:
        'Sparse XML outline (ids, names, types, position, size) for a layer or the current selection. ' +
        'Called without `nodeId` (and with an empty selection) it returns the document top-level pages instead. ' +
        'An unknown `nodeId` returns the pages list as a recovery path.',
      inputSchema: {
        type: 'object',
        properties: {
          nodeId: { type: 'string', description: 'Layer id to outline. Omit for the pages list.' },
          fileKey: { type: 'string', description: 'Ignored; Pigma serves a single open document.' },
        },
      },
    },
    handler: (args, ctx) => {
      const file = requireFile(ctx.session);
      const nodeId = optionalString(args, 'nodeId');
      if (!nodeId && ctx.session.getSelection().length === 0) {
        const pages = file.document.children.map((page) => ({ id: page.id, name: page.name }));
        return textResult(pageList(file), { pages });
      }
      const nodes = resolveTargets(file, nodeId, ctx.session.getSelection());
      if (nodes.length === 0) {
        // A page (or selection) with no layers: say so instead of returning ''.
        return textResult(`<!-- ${nodeId ?? 'selection'} has no layers -->`, { nodes: [] });
      }
      const xml = metadataXml(file, nodes);
      return textResult(xml, { nodes: nodeInventory(nodes) });
    },
  },
  {
    definition: {
      name: 'get_design_context',
      title: 'Get design context',
      description:
        'Returns framework code for a layer or the current selection, generated by Pigma from the document model. ' +
        'Defaults to React + Tailwind (the same defaults Figma\'s hosted server uses). Supported frameworks: react, html; ' +
        'styling: tailwind, css. The structured context tree is also included.',
      inputSchema: {
        type: 'object',
        properties: {
          nodeId: { type: 'string', description: 'Layer id. Omit to use the current selection.' },
          framework: { type: 'string', enum: ['react', 'html'], description: 'Output framework. Defaults to react.' },
          styling: { type: 'string', enum: ['tailwind', 'css'], description: 'Output styling. Defaults to tailwind.' },
          clientFrameworks: { type: 'string', description: 'Figma-compatible hint, e.g. "React" or "HTML".' },
          clientLanguages: { type: 'string', description: 'Accepted for compatibility.' },
        },
      },
    },
    handler: (args, ctx) => {
      const file = requireFile(ctx.session);
      const nodes = resolveTargets(file, optionalString(args, 'nodeId'), ctx.session.getSelection());
      const frameworkHint = optionalString(args, 'clientFrameworks') ?? optionalString(args, 'clientLanguages') ?? '';
      const framework = optionalString(args, 'framework') ?? (/html/i.test(frameworkHint) ? 'html' : 'react');
      const styling = optionalString(args, 'styling') ?? 'tailwind';
      if (framework !== 'react' && framework !== 'html') throw new McpToolError(`Unsupported framework "${framework}". Supported: react, html.`);
      if (styling !== 'tailwind' && styling !== 'css') throw new McpToolError(`Unsupported styling "${styling}". Supported: tailwind, css.`);
      const generated = generateDesignCode(file, nodes, { framework, styling });
      const context = designContext(file, nodes);
      return textResult(generated.code, { ...context, code: generated.code, framework: generated.framework, styling: generated.styling });
    },
  },
  {
    definition: {
      name: 'get_screenshot',
      title: 'Get screenshot',
      description:
        'Renders a layer or the current selection to a PNG image (default, like Figma) using the Pigma SVG renderer plus an ' +
        'SVG rasterizer. Pass format "svg" for vector output. Requires the host to provide a rasterizer.',
      inputSchema: {
        type: 'object',
        properties: {
          nodeId: { type: 'string', description: 'Layer id. Omit to use the current selection.' },
          format: { type: 'string', enum: ['png', 'svg'], description: 'Output format. Defaults to png.' },
          scale: { type: 'number', description: 'Pixel scale for PNG (0.01–4). Defaults to 1.' },
          enableBase64Response: { type: 'boolean', description: 'Accepted for compatibility; the image is always inline base64.' },
        },
      },
    },
    handler: (args, ctx) => {
      const file = requireFile(ctx.session);
      const format = (optionalString(args, 'format') ?? 'png').toLowerCase();
      if (format !== 'png' && format !== 'svg') {
        throw new McpToolError(`Unsupported screenshot format "${format}". Supported: png, svg.`);
      }
      const nodes = resolveTargets(file, optionalString(args, 'nodeId'), ctx.session.getSelection());
      const svg = renderSvgDocument(file, nodes);
      const bounds = selectionBounds(file, nodes);
      const nodeIds = nodes.map((node) => node.id);

      if (format === 'svg') {
        return {
          content: [{ type: 'image', data: bytesToBase64(new TextEncoder().encode(svg)), mimeType: 'image/svg+xml' }],
          structuredContent: { format: 'svg', nodeIds, width: bounds.width, height: bounds.height },
        };
      }
      if (!ctx.rasterizer) {
        throw new McpToolError('PNG screenshots require a rasterizer. Start the server with `rasterizer` (Node: `nodeRasterizer`) or request format "svg".');
      }
      const scale = optionalNumber(args, 'scale') ?? 1;
      if (scale < 0.01 || scale > 4) throw new McpToolError('`scale` must be between 0.01 and 4');
      const png = ctx.rasterizer.svgToPng(svg, { scale });
      return {
        content: [{ type: 'image', data: bytesToBase64(png), mimeType: 'image/png' }],
        structuredContent: { format: 'png', scale, nodeIds, width: Math.round(bounds.width * scale), height: Math.round(bounds.height * scale) },
      };
    },
  },
  {
    definition: {
      name: 'download_assets',
      title: 'Download assets',
      description:
        'Exports up to 20 nodes as SVG. Returns inline data URLs; Figma\'s hosted server returns temporary URLs, ' +
        'and Pigma has no asset host. Raw uploaded source images are returned for native imports that embedded them.',
      inputSchema: {
        type: 'object',
        properties: {
          nodeIds: { type: 'array', items: { type: 'string' }, description: 'Node ids to export (max 20).' },
          defaultFormat: { type: 'string', enum: ['svg'], description: 'Only "svg" is supported.' },
          defaultScale: { type: 'number', description: 'Accepted for compatibility; SVG is resolution independent.' },
        },
      },
    },
    handler: (args, ctx) => {
      const file = requireFile(ctx.session);
      const nodeIds = stringArray(args, 'nodeIds');
      if (nodeIds.length === 0) throw new McpToolError('`nodeIds` must contain at least one node id');
      if (nodeIds.length > 20) throw new McpToolError('At most 20 nodes can be exported per call');
      const format = optionalString(args, 'defaultFormat') ?? 'svg';
      if (format !== 'svg') throw new McpToolError(`Unsupported asset format "${format}": Pigma exports SVG.`);

      const assets: Array<Record<string, unknown>> = [];
      const rawImages: Array<Record<string, unknown>> = [];
      for (const nodeId of nodeIds) {
        const nodes = resolveTargets(file, nodeId, []);
        const svg = renderSvgDocument(file, nodes);
        assets.push({
          nodeId,
          format: 'svg',
          dataUrl: `data:image/svg+xml;base64,${bytesToBase64(new TextEncoder().encode(svg))}`,
        });
        for (const node of nodes) {
          for (const fill of node.fills) {
            if (fill.type === 'IMAGE' && fill.dataUrl) {
              rawImages.push({ nodeId: node.id, imageRef: fill.imageRef ?? null, dataUrl: fill.dataUrl });
            }
          }
        }
      }
      return jsonResult({ assets, rawImages, rawImagesTruncated: false });
    },
  },
  {
    definition: {
      name: 'get_variable_defs',
      title: 'Get variable definitions',
      description:
        'Variables and styles used in a layer or the current selection: variable bindings resolved to name, type, collection and ' +
        'the value under the active mode, plus style references resolved against the file styles table.',
      inputSchema: {
        type: 'object',
        properties: { nodeId: { type: 'string', description: 'Layer id. Omit to use the current selection.' } },
      },
    },
    handler: (args, ctx) => {
      const file = requireFile(ctx.session);
      const nodes = resolveTargets(file, optionalString(args, 'nodeId'), ctx.session.getSelection());
      const collected = collectVariables(file, nodes);
      const lines = [
        ...collected.variables.map((variable) => {
          const label = variable.name ? `${variable.name} (${variable.id})` : variable.id;
          const type = variable.resolvedType ? ` ${variable.resolvedType}` : '';
          const value = variable.value === null ? '' : ` = ${JSON.stringify(variable.value)}`;
          const collection = variable.collection ? ` in ${variable.collection}` : '';
          return `variable ${label}${type}${collection}${value} used by ${variable.usedBy.join(', ')}`;
        }),
        ...collected.styles.map((style) => {
          const label = style.name ? `${style.name} (${style.id})` : style.id;
          const type = style.styleType ? ` ${style.styleType}` : '';
          return `style ${label}${type} used by ${style.usedBy.join(', ')}`;
        }),
      ];
      return textResult(lines.length > 0 ? lines.join('\n') : 'No variables or styles used in the selection.', {
        variables: collected.variables,
        styles: collected.styles,
      });
    },
  },
  {
    definition: {
      name: 'get_libraries',
      title: 'Get libraries',
      description:
        'Design libraries available to the open document. Pigma serves the open file as a single subscribed library; ' +
        'remote/community/organization libraries require Figma cloud and are reported as unavailable rather than guessed.',
      inputSchema: {
        type: 'object',
        properties: {
          includeRemote: { type: 'boolean', description: 'Also request remote libraries (reported as unsupported).' },
          query: { type: 'string', description: 'Filter libraries by name.' },
        },
      },
    },
    handler: (args, ctx) => {
      const file = requireFile(ctx.session);
      const components = collectComponents(file);
      const styles = Object.values(stylesOf(file));
      const styleCounts = styles.reduce<Record<string, number>>((counts, style) => {
        counts[style.type] = (counts[style.type] ?? 0) + 1;
        return counts;
      }, {});
      const metaComponents = isRecord(file.meta?.components) ? Object.keys(file.meta.components).length : 0;
      const metaStyles = isRecord(file.meta?.styles) ? Object.keys(file.meta.styles).length : 0;
      const library = {
        name: file.name,
        libraryKey: file.source?.fileKey ?? file.name,
        description: 'Open Pigma document',
        source: 'file' as const,
        subscribed: true,
        componentCount: Math.max(components.components.length, metaComponents),
        componentSetCount: components.componentSets.length,
        styleCount: Math.max(styles.length, metaStyles),
        styleCounts,
        variableCount: Object.keys(variablesOf(file)).length,
        variableCollectionCount: Object.keys(collectionsOf(file)).length,
        variableCollections: Object.values(collectionsOf(file)).map((collection) => ({
          id: collection.id,
          name: collection.name,
          modes: collection.modes,
          activeModeId: activeModeOf(file, collection.id),
        })),
      };
      const query = optionalString(args, 'query');
      const subscribed = query ? [library].filter((entry) => entry.name.toLowerCase().includes(query.toLowerCase())) : [library];
      return jsonResult({
        subscribed,
        available: [],
        remoteSupported: false,
        note: 'Remote, community, and organization libraries require Figma cloud; only the open file is available.',
      });
    },
  },
  {
    definition: {
      name: 'search_design_system',
      title: 'Search design system',
      description:
        'Searches the open document\'s components, component sets, styles, and variables by text. Remote and organization ' +
        'libraries live in Figma cloud; Pigma searches only the open document.',
      inputSchema: {
        type: 'object',
        properties: {
          queries: { type: 'array', items: { type: 'string' }, description: 'One search intent per entry.' },
          query: { type: 'string', description: 'Single-query shorthand.' },
        },
      },
    },
    handler: (args, ctx) => {
      const file = requireFile(ctx.session);
      const queries = [...stringArray(args, 'queries'), ...(optionalString(args, 'query') ? [optionalString(args, 'query') as string] : [])];
      if (queries.length === 0) throw new McpToolError('Provide `queries` (array) or `query` (string)');

      const resources: Array<Record<string, unknown>> = [];
      const matches = (name: string): boolean => queries.some((query) => name.toLowerCase().includes(query.toLowerCase()));
      const seen = new Set<string>();
      const add = (entry: Record<string, unknown>, name: string): void => {
        const id = String(entry.id);
        if (!name || !matches(name) || seen.has(`${entry.kind}:${id}`)) return;
        seen.add(`${entry.kind}:${id}`);
        resources.push({ ...entry, name });
      };

      // Components and component sets live in the document tree.
      const components = collectComponents(file);
      for (const node of components.componentSets) add({ id: node.id, kind: 'componentSet' }, node.name);
      for (const node of components.components) add({ id: node.id, kind: 'component' }, node.name);

      // Styles and variables live in the file-level tables.
      for (const style of Object.values(stylesOf(file))) {
        add({ id: style.key, kind: 'style', key: style.key, styleType: style.type }, style.name);
      }
      for (const variable of Object.values(variablesOf(file))) {
        const collection = collectionsOf(file)[variable.variableCollectionId];
        add(
          {
            id: variable.id,
            kind: 'variable',
            resolvedType: variable.resolvedType,
            collection: collection?.name ?? null,
          },
          variable.name,
        );
      }

      // Tables preserved from a REST import that are not in the tree/model.
      const collectMeta = (table: unknown, kind: string): void => {
        if (!isRecord(table)) return;
        for (const [id, value] of Object.entries(table)) {
          if (!isRecord(value)) continue;
          add(
            {
              id,
              kind,
              key: typeof value.key === 'string' ? value.key : undefined,
              styleType: typeof value.styleType === 'string' ? value.styleType : undefined,
            },
            typeof value.name === 'string' ? value.name : '',
          );
        }
      };
      collectMeta(file.meta?.components, 'component');
      collectMeta(file.meta?.componentSets, 'componentSet');
      collectMeta(file.meta?.styles, 'style');
      return jsonResult({ queries, results: resources });
    },
  },
  {
    definition: {
      name: 'get_code_connect_map',
      title: 'Get Code Connect map',
      description:
        'Node id to code component mapping for instances in the selection. Reads the `codeConnect` table preserved on the ' +
        'document; without Code Connect configured in Figma the map is empty.',
      inputSchema: {
        type: 'object',
        properties: {
          nodeId: { type: 'string', description: 'Layer id. Omit to use the current selection.' },
          clientFrameworks: { type: 'string', description: 'Accepted for compatibility.' },
          clientLanguages: { type: 'string', description: 'Accepted for compatibility.' },
        },
      },
    },
    handler: (args, ctx) => {
      const file = requireFile(ctx.session);
      const nodes = resolveTargets(file, optionalString(args, 'nodeId'), ctx.session.getSelection());
      const table = isRecord(file.meta?.codeConnect) ? file.meta.codeConnect : {};
      const map: Record<string, unknown> = {};
      for (const node of nodes) {
        const entry = table[node.id];
        if (entry !== undefined) map[node.id] = entry;
      }
      return jsonResult({ map });
    },
  },
  {
    definition: {
      name: 'get_motion_context',
      title: 'Get motion context',
      description:
        'Prototype interactions attached to a layer or the current selection. Pigma has no keyframe animation model, ' +
        'so keyframe tracks and generated CSS/motion code are not available.',
      inputSchema: {
        type: 'object',
        properties: {
          nodeId: { type: 'string', description: 'Layer id. Omit to use the current selection.' },
          recursive: { type: 'boolean', description: 'Include animated descendants.' },
        },
      },
    },
    handler: (args, ctx) => {
      const file = requireFile(ctx.session);
      const nodes = resolveTargets(file, optionalString(args, 'nodeId'), ctx.session.getSelection());
      const recursive = optionalBoolean(args, 'recursive') ?? false;
      const interactions: Array<Record<string, unknown>> = [];
      const visit = (node: SceneNode): void => {
        if (node.interactions && node.interactions.length > 0) {
          interactions.push({ nodeId: node.id, name: node.name, interactions: node.interactions });
        }
        if (recursive && hasChildren(node)) for (const child of (node as ContainerNode).children) visit(child);
      };
      for (const node of nodes) visit(node);
      return jsonResult({
        nodes: interactions,
        keyframes: [],
        note: 'Pigma models prototype interactions only; keyframe animation is not represented.',
      });
    },
  },
];
