/**
 * Platform tools: the Figma MCP catalog entries that are not pure document
 * reads/writes — `whoami`, `get_figjam`, `generate_pigma_design`,
 * `generate_diagram`.
 *
 * Each is either implemented against Pigma's real model or returns an explicit
 * capability result; none report fake success.
 */
import { bytesToBase64 } from '../../figma/internal/base64';
import { createEllipseNode, createFrameNode, createLineNode, createPolygonNode } from '../../model/factory';
import { fromTRS } from '../../model/matrix';
import { insertChild } from '../../model/tree';
import type { AnyNode, PigmaFile, SceneNode } from '../../model/types';
import { renderSvgDocument } from '../../render/svgExport';
import { capabilityError } from '../capability';
import { McpToolError } from '../errors';
import { optionalString } from '../internal/args';
import { layoutDiagram, parseMermaidFlowchart, type MermaidNode } from '../mermaid';
import { jsonResult, type RegisteredTool } from '../registry';
import { requireFile, requireSnapshot, resolveTargets } from '../session';
import { metadataXml, nodeInventory } from '../serialize';

const SHAPE_FACTORY: Record<
  MermaidNode['shape'],
  (root: AnyNode, x: number, y: number, w: number, h: number) => SceneNode
> = {
  RECT: createFrameNode,
  ROUND: createFrameNode,
  DIAMOND: (root, x, y, w, h) => createPolygonNode(root, x, y, w, h),
  ELLIPSE: createEllipseNode,
};

/** Build a Mermaid flowchart into the open document. */
function buildDiagram(
  file: PigmaFile,
  source: string,
  parentId: string | undefined,
): { file: PigmaFile; created: string[]; unsupported: string[] } {
  const diagram = parseMermaidFlowchart(source);
  if (diagram.nodes.length === 0) {
    throw new McpToolError(
      'No flowchart nodes found. `generate_diagram` supports Mermaid flowcharts (graph/flowchart TD|TB|LR|RL).',
    );
  }
  const { placements } = layoutDiagram(diagram);
  const page = parentId ?? file.document.children[0]?.id;
  if (!page) throw new McpToolError('Document has no pages');
  let document = file.document;
  const created: string[] = [];
  const byId = new Map<string, { frame: SceneNode; placement: { x: number; y: number; width: number; height: number } }>();

  for (const node of diagram.nodes) {
    const placement = placements.get(node.id);
    if (!placement) continue;
    const frame = SHAPE_FACTORY[node.shape](document, placement.x, placement.y, placement.width, placement.height);
    frame.name = node.label;
    frame.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, visible: true }];
    frame.strokes = [{ type: 'SOLID', color: { r: 0.35, g: 0.38, b: 0.42 }, visible: true }];
    frame.strokeWeight = 1;
    if (node.shape === 'ROUND' || node.shape === 'RECT') {
      (frame as SceneNode & { cornerRadius?: number }).cornerRadius = node.shape === 'ROUND' ? 16 : 4;
    }
    if (node.shape === 'DIAMOND') {
      (frame as SceneNode & { pointCount?: number }).pointCount = 4;
      const size = Math.min(placement.width, placement.height);
      frame.width = size;
      frame.height = size;
      frame.transform = fromTRS(placement.x + placement.width / 2, placement.y + placement.height / 2, 45, 1, 1);
    }
    document = insertChild(document, page, frame);
    created.push(frame.id);
    byId.set(node.id, { frame, placement });
  }

  for (const edge of diagram.edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) continue;
    const x1 = from.placement.x + from.placement.width / 2;
    const y1 = from.placement.y + from.placement.height / 2;
    const x2 = to.placement.x + to.placement.width / 2;
    const y2 = to.placement.y + to.placement.height / 2;
    const length = Math.max(1, Math.hypot(x2 - x1, y2 - y1));
    const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
    const line = createLineNode(document, 0, 0, length);
    line.transform = fromTRS(x1, y1, angle, 1, 1);
    line.strokes = [{ type: 'SOLID', color: { r: 0.35, g: 0.38, b: 0.42 }, visible: true }];
    line.strokeWeight = 1;
    line.strokeCap = 'ARROW_LINES';
    line.name = edge.label ? `${edge.from} → ${edge.to}: ${edge.label}` : `${edge.from} → ${edge.to}`;
    document = insertChild(document, page, line);
    created.push(line.id);
  }

  return { file: { ...file, document, lastModified: Date.now() }, created, unsupported: diagram.unsupported };
}

/**
 * The generative-plugin and shader families need Figma's account library, build
 * pipeline, and shader runtime, none of which Pigma has. They are registered so
 * no tool is silently missing, and each returns an explicit capability result.
 */
function capabilityTool(
  name: string,
  title: string,
  description: string,
  reason: string,
  alternatives: string[],
  properties: Record<string, unknown> = {},
): RegisteredTool {
  return {
    definition: { name, title, description, inputSchema: { type: 'object', properties } },
    handler: () => capabilityError(name, reason, alternatives),
  };
}

const GENERATIVE_REASON =
  'Pigma has no account library, plugin build pipeline, or shader runtime; generative plugins and shaders cannot be stored, built, or executed.';
const GENERATIVE_ALTERNATIVES = ['use_pigma (run a plugin script against the open document)'];

export const generativeTools: RegisteredTool[] = [
  capabilityTool('list_generative_plugins', 'List generative plugins', 'Lists generative plugins in the account library. Not available in Pigma.', GENERATIVE_REASON, GENERATIVE_ALTERNATIVES, {
    cursor: { type: 'string', description: 'Pagination cursor.' },
  }),
  capabilityTool('get_generative_plugin', 'Get generative plugin', 'Reads a generative plugin from the account library by id. Not available in Pigma.', GENERATIVE_REASON, GENERATIVE_ALTERNATIVES, {
    id: { type: 'string' },
    version: { type: 'string' },
    includeSource: { type: 'boolean' },
  }),
  capabilityTool('create_generative_plugin', 'Create generative plugin', 'Creates a generative plugin scaffold in the account library. Not available in Pigma.', GENERATIVE_REASON, GENERATIVE_ALTERNATIVES, {
    name: { type: 'string' },
    description: { type: 'string' },
    planKey: { type: 'string' },
  }),
  capabilityTool('update_generative_plugin', 'Update generative plugin', 'Replaces a generative plugin\'s source. Not available in Pigma.', GENERATIVE_REASON, GENERATIVE_ALTERNATIVES, {
    id: { type: 'string' },
    commitMessage: { type: 'string' },
    files: { type: 'array', items: { type: 'object' } },
    metadata: { type: 'object' },
  }),
  capabilityTool('list_shaders', 'List shaders', 'Lists shader effects and fills in the account library. Not available in Pigma.', GENERATIVE_REASON, GENERATIVE_ALTERNATIVES, {
    cursor: { type: 'string' },
  }),
  capabilityTool('list_file_shaders', 'List file shaders', 'Lists shaders used in the open file. Pigma does not model shader fills or effects.', GENERATIVE_REASON, GENERATIVE_ALTERNATIVES, {
    fileKey: { type: 'string', description: 'Key of the Figma file.' },
  }),
  capabilityTool('get_shader', 'Get shader', 'Reads a shader from the account library by id. Not available in Pigma.', GENERATIVE_REASON, GENERATIVE_ALTERNATIVES, {
    id: { type: 'string' },
    version: { type: 'string' },
    includeSource: { type: 'boolean' },
  }),
  capabilityTool('create_shader', 'Create shader', 'Creates a shader fill or effect scaffold. Not available in Pigma.', GENERATIVE_REASON, GENERATIVE_ALTERNATIVES, {
    name: { type: 'string' },
    description: { type: 'string' },
    planKey: { type: 'string' },
    kind: { type: 'string', enum: ['effect', 'fill'] },
  }),
  capabilityTool('update_shader', 'Update shader', 'Replaces a shader\'s source. Not available in Pigma.', GENERATIVE_REASON, GENERATIVE_ALTERNATIVES, {
    id: { type: 'string' },
    kind: { type: 'string', enum: ['effect', 'fill'], description: 'Must match the existing resource.' },
    commitMessage: { type: 'string' },
    files: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } } },
    metadata: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' } } },
  }),
];

const WEAVE_REASON =
  'Weave tools run published workflows on weavy.ai and need a Weave account, workspace, and credits; Pigma has no Weave backend.';
const WEAVE_ALTERNATIVES = ['generate_diagram (Mermaid flowcharts)', 'use_pigma (create layers programmatically)'];

/**
 * The published Weave surface. None of it can run without the Weave service, so
 * each tool is registered with Figma's parameter shape and returns an explicit
 * capability result.
 */
export const weaveTools: RegisteredTool[] = [
  capabilityTool('weave_list_tools', 'List Weave tools', 'Lists the published Weave workflows the user can run. Not available in Pigma.', WEAVE_REASON, WEAVE_ALTERNATIVES, {
    search: { type: 'string', description: 'Case-insensitive substring matched against tool names.' },
  }),
  capabilityTool('weave_get_tool_inputs', 'Get Weave tool inputs', 'Gets the input contract of a Weave tool. Not available in Pigma.', WEAVE_REASON, WEAVE_ALTERNATIVES, {
    recipeId: { type: 'string', description: 'Id of the Weave tool.' },
    version: { type: 'string', description: 'Tool version to inspect; omit for latest.' },
  }),
  capabilityTool('weave_upload_asset', 'Upload Weave asset', 'Turns a file into a hosted URL for a Weave run. Not available in Pigma.', WEAVE_REASON, WEAVE_ALTERNATIVES, {
    recipeId: { type: 'string', description: 'The Weave tool the asset is for.' },
  }),
  capabilityTool('weave_run_tool', 'Run Weave tool', 'Runs a Weave tool (spends Weave credits). Not available in Pigma.', WEAVE_REASON, WEAVE_ALTERNATIVES, {
    recipeId: { type: 'string' },
    version: { type: 'string' },
    inputs: { type: 'array', items: { type: 'object', properties: { nodeId: { type: 'string' }, value: {} } } },
    numberOfRuns: { type: 'number', description: '1-10.' },
    acknowledgedCost: { type: 'boolean' },
  }),
  capabilityTool('weave_get_tool_run_output', 'Get Weave run output', 'Gets the output and status of Weave runs. Not available in Pigma.', WEAVE_REASON, WEAVE_ALTERNATIVES, {
    recipeId: { type: 'string' },
    runIds: { type: 'array', items: { type: 'string' } },
  }),
  capabilityTool('weave_cancel_tool_run', 'Cancel Weave run', 'Cancels in-progress Weave runs. Not available in Pigma.', WEAVE_REASON, WEAVE_ALTERNATIVES, {
    recipeId: { type: 'string' },
    runIds: { type: 'array', items: { type: 'string' }, description: 'Omit to cancel all.' },
  }),
];

export const platformTools: RegisteredTool[] = [
  {
    definition: {
      name: 'whoami',
      title: 'Who am I',
      description:
        'Figma returns the authenticated user and their plans. Pigma has no accounts, authentication, or cloud plans, so this reports an explicit capability result.',
      inputSchema: { type: 'object', properties: {} },
    },
    handler: () =>
      capabilityError(
        'whoami',
        'Pigma is a local editor with no accounts, authentication, or cloud plans.',
        ['No authentication is required; tools operate on the open local document.'],
      ),
  },
  {
    definition: {
      name: 'get_figjam',
      title: 'Get FigJam content',
      description:
        'Metadata for FigJam-style diagrams: an XML outline plus PNG screenshots of the selected nodes. ' +
        "Pigma does not model FigJam-specific semantics (connectors, tables, stickies); those fields stay in each node's raw metadata.",
      inputSchema: {
        type: 'object',
        properties: {
          nodeId: { type: 'string', description: 'Diagram node. Omit to use the current selection.' },
          screenshotLimit: { type: 'number', description: 'Max node screenshots to embed (default 5).' },
        },
      },
    },
    handler: (args, ctx) => {
      const file = requireFile(ctx.session);
      const nodes = resolveTargets(file, optionalString(args, 'nodeId'), ctx.session.getSelection());
      const xml = metadataXml(file, nodes);
      const rawLimit = args.screenshotLimit;
      const limit = typeof rawLimit === 'number' && rawLimit > 0 ? Math.min(rawLimit, 20) : 5;

      const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [
        { type: 'text', text: xml },
      ];
      let screenshots = 0;
      if (ctx.rasterizer) {
        for (const node of nodes.slice(0, limit)) {
          const png = ctx.rasterizer.svgToPng(renderSvgDocument(file, [node]), { scale: 1 });
          content.push({ type: 'image', data: bytesToBase64(png), mimeType: 'image/png' });
          screenshots += 1;
        }
      }
      return {
        content,
        structuredContent: {
          nodes: nodeInventory(nodes),
          screenshots,
          capabilities: {
            xmlOutline: true,
            screenshots: ctx.rasterizer !== undefined,
            figjamSemantics: false,
            note: 'FigJam connectors/tables/stickies are not modelled; original fields remain in node raw metadata.',
          },
        },
      };
    },
  },
  {
    definition: {
      name: 'generate_pigma_design',
      title: 'Generate design from code',
      description:
        'Figma captures live web UI into design layers. PIGMA HAS NO BROWSER-CAPTURE BACKEND, so this reports an explicit capability result — ' +
        'nothing is fetched and no design is generated. Use use_pigma or create_new_file to build layers locally instead.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Page URL to capture.' },
          nodeId: { type: 'string', description: 'Target node.' },
        },
      },
    },
    handler: () =>
      capabilityError(
        'generate_pigma_design',
        'Pigma has no browser/code-to-canvas capture backend; it cannot render a live web page into design layers.',
        ['use_pigma (create layers programmatically)', 'create_new_file', 'upload_assets'],
      ),
  },
  {
    definition: {
      name: 'generate_diagram',
      title: 'Generate diagram',
      description:
        'Builds a diagram in the open document from Mermaid flowchart syntax (graph/flowchart TD|TB|LR|RL, node shapes, labelled edges). ' +
        'Other Mermaid diagram types and natural-language input are reported as unsupported.',
      inputSchema: {
        type: 'object',
        properties: {
          mermaid: { type: 'string', description: 'Mermaid flowchart source.' },
          description: { type: 'string', description: 'Natural-language description (needs an LLM; unsupported here).' },
          parentId: { type: 'string', description: 'Container to add the diagram to. Defaults to the first page.' },
        },
      },
    },
    handler: async (args, ctx) => {
      const source = optionalString(args, 'mermaid');
      if (!source) {
        return capabilityError(
          'generate_diagram',
          'Natural-language diagram generation requires an LLM; Pigma accepts Mermaid flowchart syntax only.',
          ['Pass `mermaid` with a flowchart, e.g. "graph LR; A[Start] --> B{Choice}; B --> C[Done]".'],
        );
      }
      const { file, revision } = await requireSnapshot(ctx.session);
      const built = buildDiagram(file, source, optionalString(args, 'parentId'));
      await ctx.session.setFile(built.file, { expectedRevision: revision });
      const ignored = [...new Set(built.unsupported)];
      return jsonResult({
        created: built.created,
        ignored,
        note: ignored.length > 0 ? `Ignored unsupported Mermaid directives: ${ignored.join(', ')}` : undefined,
      });
    },
  },
];
