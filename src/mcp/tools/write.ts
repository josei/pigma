/**
 * Write tools: the Figma MCP "code to design" write surface, implemented
 * against the Pigma document model.
 *
 * `use_pigma` accepts an actual Figma Plugin API script and executes it in an
 * isolated QuickJS sandbox (shared engine in `src/plugins/`, Node loader in
 * `src/mcp/plugin/`) with no host filesystem/network access. A declarative Plugin-API-shaped `operations` list is kept as a
 * secondary interface. See `docs/MCP.md` for the supported API subset.
 */
import type { AnyNode, DocumentNode, Paint, PigmaFile, SceneNode } from '../../model/types';
import {
  createCanvasNode,
  createDocument,
  createEllipseNode,
  createFrameNode,
  createLineNode,
  createPolygonNode,
  createRectNode,
  createStarNode,
  createTextNode,
} from '../../model/factory';
import { findNode, insertChild, moveNode, removeNode, updateNode } from '../../model/tree';
import { McpToolError } from '../errors';
import { isRecord, objectArray, optionalBoolean, optionalNumber, optionalString, stringArray } from '../internal/args';
import { createPluginInterpreter } from '../plugin/interpreter';
import type { PluginInterpreter } from '../../plugins/engine';
import { jsonResult, textResult, type RegisteredTool, type ToolContext } from '../registry';
import { currentRevision, requireSnapshot, resolveTargets } from '../session';
import { designContext } from '../serialize';

let interpreterSingleton: PluginInterpreter | null = null;

function sharedInterpreter(): PluginInterpreter {
  interpreterSingleton ??= createPluginInterpreter();
  return interpreterSingleton;
}

const SHAPE_FACTORIES = {
  createRectangle: createRectNode,
  createEllipse: createEllipseNode,
  createPolygon: createPolygonNode,
  createStar: createStarNode,
} as const;

function defaultParent(file: PigmaFile, parentId: string | undefined): { parent: AnyNode; id: string } {
  if (parentId) {
    const parent = findNode(file.document, parentId);
    if (!parent) throw new McpToolError(`Unknown parent node id "${parentId}"`);
    return { parent, id: parentId };
  }
  const page = file.document.children[0];
  if (!page) throw new McpToolError('Document has no pages');
  return { parent: page, id: page.id };
}

function numberArg(args: Record<string, unknown>, key: string, fallback: number): number {
  const value = args[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function createNodeFor(file: PigmaFile, method: string, args: Record<string, unknown>): SceneNode {
  const x = numberArg(args, 'x', 0);
  const y = numberArg(args, 'y', 0);
  const width = numberArg(args, 'width', 100);
  const height = numberArg(args, 'height', 100);
  if (method === 'createText') return createTextNode(file.document, x, y, optionalString(args, 'characters') ?? 'Text');
  if (method === 'createFrame') return createFrameNode(file.document, x, y, width, height);
  if (method === 'createLine') return createLineNode(file.document, x, y, width);
  const factory = SHAPE_FACTORIES[method as keyof typeof SHAPE_FACTORIES];
  if (!factory) {
    throw new McpToolError(
      `Unknown factory "${method}". Supported: figma.createFrame, createRectangle, createEllipse, createLine, createPolygon, createStar, createText, createPage.`,
    );
  }
  return factory(file.document, x, y, width, height);
}

/** Fields settable through `<nodeId>.set` (Plugin API property assignment). */
function setNodeFields(file: PigmaFile, nodeId: string, args: Record<string, unknown>): PigmaFile {
  const name = optionalString(args, 'name');
  const opacity = optionalNumber(args, 'opacity');
  const visible = optionalBoolean(args, 'visible');
  const width = optionalNumber(args, 'width');
  const height = optionalNumber(args, 'height');
  const x = optionalNumber(args, 'x');
  const y = optionalNumber(args, 'y');
  const characters = optionalString(args, 'characters');
  const cornerRadius = optionalNumber(args, 'cornerRadius');
  const document = updateNode(file.document, nodeId, (node: AnyNode) => {
    const next = { ...node } as AnyNode & Record<string, unknown>;
    if (name !== undefined) next.name = name;
    if (opacity !== undefined) next.opacity = opacity;
    if (visible !== undefined) next.visible = visible;
    if (width !== undefined) next.width = width;
    if (height !== undefined) next.height = height;
    if (cornerRadius !== undefined) next.cornerRadius = cornerRadius;
    if (characters !== undefined && next.type === 'TEXT') next.characters = characters;
    if (x !== undefined || y !== undefined) {
      next.transform = { ...next.transform, tx: x ?? next.transform.tx, ty: y ?? next.transform.ty };
    }
    if (Array.isArray(args.fills)) next.fills = args.fills as Paint[];
    return next as AnyNode;
  });
  return { ...file, document, lastModified: Date.now() };
}

interface CallResult {
  nodeId?: string;
  nodeIds?: string[];
  pageId?: string;
  removed?: boolean;
  context?: Record<string, unknown>;
}

/** Execute one Plugin-API-shaped call (the secondary `operations` interface). */
async function applyCall(
  file: PigmaFile,
  call: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
  revision: number | undefined,
): Promise<{ file: PigmaFile; result: CallResult }> {
  if (call.startsWith('figma.')) {
    const method = call.slice('figma.'.length);
    if (method === 'createPage') {
      const page = createCanvasNode(optionalString(args, 'name') ?? 'Page');
      const document = insertChild(file.document, file.document.id, page);
      return { file: { ...file, document, lastModified: Date.now() }, result: { pageId: page.id } };
    }
    if (method === 'getNodeById') {
      const nodeId = optionalString(args, 'nodeId');
      if (!nodeId) throw new McpToolError('figma.getNodeById requires `nodeId`');
      return { file, result: { nodeId, context: designContext(file, resolveTargets(file, nodeId, [])) } };
    }
    if (method === 'currentPage.appendChild') {
      const nodeId = optionalString(args, 'nodeId');
      if (!nodeId) throw new McpToolError('figma.currentPage.appendChild requires `nodeId`');
      const { id: parentId } = defaultParent(file, undefined);
      const document = moveNode(file.document, nodeId, parentId, Number.MAX_SAFE_INTEGER);
      return { file: { ...file, document, lastModified: Date.now() }, result: { nodeId, pageId: parentId } };
    }
    if (method === 'currentPage.selection') {
      const nodeIds = stringArray(args, 'nodeIds');
      await ctx.session.setSelection(nodeIds, { expectedRevision: revision });
      return { file, result: { nodeIds } };
    }
    if (method.startsWith('create')) {
      const node = createNodeFor(file, method, args);
      const named = optionalString(args, 'name');
      if (named) node.name = named;
      const { id: parentId } = defaultParent(file, optionalString(args, 'parentId'));
      const document = insertChild(file.document, parentId, node);
      return { file: { ...file, document, lastModified: Date.now() }, result: { nodeId: node.id } };
    }
    throw new McpToolError(`Unknown figma call "${call}"`);
  }

  const separator = call.lastIndexOf('.');
  if (separator <= 0) throw new McpToolError(`Malformed call "${call}". Use "figma.<method>" or "<nodeId>.<method>".`);
  const nodeId = call.slice(0, separator);
  const method = call.slice(separator + 1);

  if (method === 'resize') {
    return {
      file: setNodeFields(file, nodeId, { width: numberArg(args, 'width', 100), height: numberArg(args, 'height', 100) }),
      result: { nodeId },
    };
  }
  if (method === 'set') return { file: setNodeFields(file, nodeId, args), result: { nodeId } };
  if (method === 'appendChild') {
    const childId = optionalString(args, 'nodeId');
    if (!childId) throw new McpToolError(`${call} requires args.nodeId`);
    const document = moveNode(file.document, childId, nodeId, Number.MAX_SAFE_INTEGER);
    return { file: { ...file, document, lastModified: Date.now() }, result: { nodeId: childId } };
  }
  if (method === 'remove') {
    const removed = removeNode(file.document, nodeId);
    return { file: { ...file, document: removed.root, lastModified: Date.now() }, result: { nodeId, removed: removed.removed !== null } };
  }
  if (method === 'get') {
    return { file, result: { nodeId, context: designContext(file, resolveTargets(file, nodeId, [])) } };
  }
  throw new McpToolError(`Unknown node method "${method}" on ${nodeId}. Supported: resize, set, appendChild, remove, get.`);
}

export const writeTools: RegisteredTool[] = [
  {
    definition: {
      name: 'use_pigma',
      title: 'Use Pigma',
      description:
        'Runs a script written in the FIGMA PLUGIN API DIALECT inside PIGMA\'S OWN SANDBOX, then applies the result to the open Pigma document. ' +
        'The dialect is Figma\'s (so Figma plugin snippets and instructions work unchanged); the execution, the document and the result are ' +
        'entirely local — the open document lives on this machine (a local file, or the editor connected over the bridge), and NOTHING is ' +
        'fetched from Figma or any cloud service. ' +
        'The sandbox has no host filesystem or network access. ' +
        'Supported: figma.createFrame/Rectangle/Ellipse/Line/Polygon/Star/Text/Vector/Component, figma.union/subtract/intersect/exclude, ' +
        'figma.combineAsVariants, figma.currentPage (children, appendChild, selection), figma.getNodeById, figma.root, figma.closePlugin, ' +
        'figma.notify, figma.loadFontAsync, figma.on("run") with plugin `parameters`; node properties (name, x, y, width, height, opacity, ' +
        'visible, fills, strokes, effects, characters, cornerRadius, rectangleCornerRadii, rotation, windingRule, vectorPaths, styles, ' +
        'boundVariables, componentPropertyReferences, componentProperties) and methods (resize, appendChild, remove, createInstance, ' +
        'setProperties, mainComponent). Scripts may `await`; the result is the completion value or, when the script registers ' +
        'figma.on("run", handler), that handler\'s return value. The result carries `warnings` for input the engine converted or skipped ' +
        'rather than honoured. The full supported subset and its limits are in docs/MCP.md. ' +
'A declarative `operations` list is also accepted as a secondary interface.',
      inputSchema: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Figma Plugin API script to execute in the sandbox.' },
          timeoutMs: { type: 'number', description: 'Script wall-clock budget in ms. Default 2000.' },
          parameters: {
            type: 'object',
            description: 'Plugin parameter values, delivered to figma.on("run") as `parameters` (Figma semantics).',
          },
          command: { type: 'string', description: 'Plugin command, delivered to the run event.' },
          operations: {
            type: 'array',
            description: 'Secondary interface: ordered Plugin-API-shaped calls.',
            items: {
              type: 'object',
              required: ['call'],
              properties: {
                call: { type: 'string', description: 'e.g. "figma.createRectangle", "1:2.resize", "1:2.set".' },
                args: { type: 'object', description: 'Call arguments.' },
              },
            },
          },
        },
      },
    },
    handler: async (args, ctx) => {
      let { file, revision } = await requireSnapshot(ctx.session);
      const code = optionalString(args, 'code');
      const operations = objectArray(args, 'operations');
      if (!code && operations.length === 0) {
        throw new McpToolError('Provide `code` (Figma Plugin API script) or `operations`.');
      }

      if (code) {
        const interpreter = ctx.interpreter ?? sharedInterpreter();
        const timeoutMs = optionalNumber(args, 'timeoutMs');
        const command = optionalString(args, 'command');
        const parameters = isRecord(args.parameters) ? args.parameters : undefined;
        const result = await interpreter.run(code, file, {
          ...(timeoutMs === undefined ? {} : { timeoutMs }),
          ...(command === undefined ? {} : { command }),
          ...(parameters === undefined ? {} : { parameters }),
        });
        await ctx.session.setFile(result.file, { expectedRevision: revision });
        return jsonResult({
          output: result.output ?? null,
          logs: result.logs,
          warnings: result.warnings,
          closed: result.closed,
          results: [],
        });
      }

      const results: Array<Record<string, unknown>> = [];
      for (const operation of operations) {
        const call = optionalString(operation, 'call');
        if (!call) throw new McpToolError('Each operation requires a `call` string');
        const callArgs = isRecord(operation.args) ? operation.args : {};
        const applied = await applyCall(file, call, callArgs, ctx, revision);
        file = applied.file;
        results.push({ call, ...applied.result });
      }

      await ctx.session.setFile(file);
      return jsonResult({ results });
    },
  },
  {
    definition: {
      name: 'create_new_file',
      title: 'Create new file',
      description:
        'Creates a new blank Pigma Design file and makes it the open document. FigJam and Figma Slides files are not supported.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'File name.' },
          editorType: { type: 'string', enum: ['design', 'figjam', 'slides'], description: 'Only "design" is supported.' },
        },
      },
    },
    handler: async (args, ctx) => {
      const editorType = optionalString(args, 'editorType') ?? 'design';
      if (editorType !== 'design') {
        throw new McpToolError(`Unsupported editorType "${editorType}": Pigma implements Figma Design only.`);
      }
      const name = optionalString(args, 'name') ?? 'Untitled';
      // Capture this call's authoritative revision so a concurrent local edit is
      // detected instead of being overwritten. `currentRevision` (not
      // `requireSnapshot`) because this tool is what creates the document: with
      // none open there is nothing to guard, and demanding one would make the
      // "no document is loaded" error point at the tool that fixes it.
      const revision = await currentRevision(ctx.session);
      const document: DocumentNode = createDocument(name);
      const file: PigmaFile = { schema: 'pigma/1', name, lastModified: Date.now(), document };
      await ctx.session.setFile(file, { expectedRevision: revision });
      // The write moved the revision, so re-read it: clearing the selection is a
      // write too, and the registry-level coverage test asserts every write
      // carries the revision the session was at.
      await ctx.session.setSelection([], { expectedRevision: await currentRevision(ctx.session) });
      return jsonResult({ name, editorType: 'design', documentId: document.id, pageId: document.children[0]?.id ?? null });
    },
  },
  {
    definition: {
      name: 'upload_assets',
      title: 'Upload assets',
      description:
        'Places base64 image assets into the open document. With `nodeId`, the image is set as a fill on that node; otherwise a new frame is created ' +
        'per image. Pigma has no cloud upload, so assets live in the document as data URLs.',
      inputSchema: {
        type: 'object',
        properties: {
          nodeId: { type: 'string', description: 'Node to fill. Omit to create new frames.' },
          images: {
            type: 'array',
            items: {
              type: 'object',
              required: ['dataUrl'],
              properties: { dataUrl: { type: 'string' }, name: { type: 'string' } },
            },
          },
        },
        required: ['images'],
      },
    },
    handler: async (args, ctx) => {
      let { file, revision } = await requireSnapshot(ctx.session);
      const images = objectArray(args, 'images');
      if (images.length === 0) throw new McpToolError('`images` must contain at least one asset');
      const nodeId = optionalString(args, 'nodeId');
      const placed: Array<Record<string, unknown>> = [];

      for (let index = 0; index < images.length; index++) {
        const image = images[index] as Record<string, unknown>;
        const dataUrl = optionalString(image, 'dataUrl');
        if (!dataUrl || !dataUrl.startsWith('data:image/')) {
          throw new McpToolError('Each image needs a `dataUrl` starting with "data:image/"');
        }
        const paint: Paint = { type: 'IMAGE', dataUrl, scaleMode: 'FILL', visible: true };
        if (nodeId) {
          const document = updateNode(file.document, nodeId, (node: AnyNode) => ({ ...node, fills: [paint] }) as AnyNode);
          file = { ...file, document, lastModified: Date.now() };
          placed.push({ nodeId, imageRef: null });
        } else {
          const { id: parentId } = defaultParent(file, undefined);
          const frame = createFrameNode(file.document, index * 20, index * 20, 400, 300, { fills: [paint] });
          const document = insertChild(file.document, parentId, frame);
          file = { ...file, document, lastModified: Date.now() };
          placed.push({ nodeId: frame.id, imageRef: null });
        }
      }

      await ctx.session.setFile(file, { expectedRevision: revision });
      return textResult(`Placed ${placed.length} asset(s).`, { placed });
    },
  },
];
