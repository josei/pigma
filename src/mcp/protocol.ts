/**
 * MCP request dispatch.
 *
 * Implements the JSON-RPC 2.0 surface of the Model Context Protocol:
 * `initialize`, `tools/list`, `tools/call`, `resources/list`,
 * `resources/templates/list`, `resources/read`, `prompts/list`, `prompts/get`,
 * `ping`, and `logging/setLevel`.
 *
 * The server is protocol-generic: it accepts any client identity. There is no
 * client-name, vendor, or harness allowlist — `clientInfo` is only echoed into
 * nothing and never gates a request.
 */
import { McpToolError } from './errors';
import { allTools } from './tools/index';
import { advertisedTools, SELF_HOSTED_STATE, type McpState } from './toolCatalog';
import type { RegisteredTool, ToolContext } from './registry';
import { pageList, requireFile, type DocumentSession } from './session';
import { designContext, metadataXml } from './serialize';
import type { Rasterizer } from './raster';
import type { PluginInterpreter } from '../plugins/engine';
import { isSceneNode } from '../model/types';
import { descendants } from '../model/tree';
import {
  ErrorCode,
  LATEST_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  type JsonRpcRequest,
  type InitializeResult,
  type JsonRpcId,
  type JsonRpcMessage,
  type JsonRpcResponse,
  type PromptDefinition,
  type ResourceDefinition,
  type ServerCapabilities,
  type ToolCallResult,
} from './types';

export interface McpServerOptions {
  session: DocumentSession;
  name?: string;
  version?: string;
  instructions?: string;
  tools?: RegisteredTool[];
  interpreter?: PluginInterpreter;
  /** SVG→PNG rasterizer; without it `get_screenshot` reports a clear error. */
  rasterizer?: Rasterizer;
  /**
   * Which state this endpoint serves. A tool that needs the desktop shell is not
   * advertised where the shell is absent (see `src/mcp/toolCatalog.ts`).
   */
  state?: McpState;
}

export interface McpServer {
  readonly name: string;
  readonly version: string;
  readonly tools: RegisteredTool[];
  handle(message: JsonRpcMessage): Promise<JsonRpcResponse | null>;
}

const RESOURCES: ResourceDefinition[] = [
  { uri: 'pigma://document', name: 'document', title: 'Open document', description: 'The open Pigma file as JSON.', mimeType: 'application/json' },
  { uri: 'pigma://document/metadata', name: 'metadata', title: 'Document metadata', description: 'Sparse XML outline of every page.', mimeType: 'application/xml' },
  { uri: 'pigma://document/selection', name: 'selection', title: 'Current selection', description: 'Design context for the current selection.', mimeType: 'application/json' },
];

const PROMPTS: PromptDefinition[] = [
  {
    name: 'create_design_system_rules',
    title: 'Create design system rules',
    description:
      'A prompt for creating a rule file that provides agents with the right context to translate designs into high-quality, ' +
      'codebase-aware frontend code. It helps ensure alignment with your design system and tech stack, improving the relevance ' +
      'and accuracy of generated output. Save the result to the correct rules/ or instructions/ path.',
  },
];

function protocolVersion(requested: string | undefined): string {
  if (requested && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)) return requested;
  return LATEST_PROTOCOL_VERSION;
}

function isRequest(message: JsonRpcMessage): message is JsonRpcRequest & { id: JsonRpcId } {
  return (
    typeof message === 'object' &&
    message !== null &&
    'method' in message &&
    'id' in message &&
    (message as JsonRpcRequest).id !== undefined
  );
}

function failure(id: JsonRpcId, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/**
 * Tools renamed off the Figma brand (product decision, docs/MCP.md#naming). Kept
 * here so a caller using an old name is told the replacement rather than just
 * "unknown tool". The migration table in docs/MCP.md lists the same pairs.
 */
const RENAMED_TOOLS: Record<string, string> = {
  use_figma: 'use_pigma',
  generate_figma_design: 'generate_pigma_design',
};

function success(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

export function createMcpServer(options: McpServerOptions): McpServer {
  const session = options.session;
  const state = options.state ?? SELF_HOSTED_STATE;
  const tools = advertisedTools(options.tools ?? allTools, state);
  const name = options.name ?? 'pigma';
  const version = options.version ?? '0.1.0';
  const toolContext: ToolContext = { session, rasterizer: options.rasterizer, interpreter: options.interpreter };

  const capabilities: ServerCapabilities = {
    tools: { listChanged: false },
    resources: { subscribe: false, listChanged: false },
    prompts: { listChanged: false },
    logging: {},
  };

  const readResource = (uri: string): { uri: string; mimeType: string; text: string } => {
    const file = requireFile(session);
    if (uri === 'pigma://document') {
      return { uri, mimeType: 'application/json', text: JSON.stringify(file, null, 2) };
    }
    if (uri === 'pigma://document/metadata') {
      const nodes = file.document.children.flatMap((page) => {
        const scene = [];
        for (const child of descendants(page)) if (isSceneNode(child)) scene.push(child);
        return scene;
      });
      return { uri, mimeType: 'application/xml', text: `<!-- pages -->\n${pageList(file)}\n${metadataXml(file, nodes)}` };
    }
    if (uri === 'pigma://document/selection') {
      const selection = new Set(session.getSelection());
      const nodes = [];
      for (const node of descendants(file.document)) {
        if (selection.has(node.id) && isSceneNode(node)) nodes.push(node);
      }
      return { uri, mimeType: 'application/json', text: JSON.stringify(designContext(file, nodes), null, 2) };
    }
    throw new McpToolError(`Unknown resource uri "${uri}"`);
  };

  const callTool = async (params: Record<string, unknown>): Promise<ToolCallResult> => {
    const toolName = params.name;
    if (typeof toolName !== 'string') throw new McpToolError('tools/call requires a `name`');
    const tool = tools.find((entry) => entry.definition.name === toolName);
    if (!tool) {
      // A saved config or skill may still call a pre-rename name: say so, and
      // point at the replacement, instead of a bare "unknown tool".
      const replacement = RENAMED_TOOLS[toolName];
      throw new McpToolError(
        replacement
          ? `Unknown tool "${toolName}": it was renamed to "${replacement}". Pigma names its own tools; the Figma ` +
            'compatibility is stated in the description. See the migration table in docs/MCP.md.'
          : `Unknown tool "${toolName}"`,
      );
    }
    const args = params.arguments === undefined || params.arguments === null ? {} : params.arguments;
    return tool.handler(args as Record<string, unknown>, toolContext);
  };

  const dispatch = async (message: JsonRpcMessage): Promise<JsonRpcResponse | null> => {
    if (!isRequest(message)) return null; // notification
    const id = message.id;
    const method = message.method;
    const params = (message.params ?? {}) as Record<string, unknown>;

    switch (method) {
      case 'initialize': {
        const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : undefined;
        const result: InitializeResult = {
          protocolVersion: protocolVersion(requested),
          capabilities,
          serverInfo: { name, title: 'Pigma', version },
        };
        if (options.instructions) result.instructions = options.instructions;
        return success(id, result);
      }
      case 'ping':
        return success(id, {});
      case 'logging/setLevel':
        return success(id, {});
      case 'tools/list':
        return success(id, { tools: tools.map((tool) => tool.definition) });
      case 'tools/call': {
        try {
          const result = await callTool(params);
          return success(id, result);
        } catch (error) {
          if (error instanceof McpToolError) {
            return success(id, { content: [{ type: 'text', text: error.message }], isError: true });
          }
          const detail = error instanceof Error ? error.message : String(error);
          return success(id, { content: [{ type: 'text', text: `Tool failed: ${detail}` }], isError: true });
        }
      }
      case 'resources/list':
        return success(id, { resources: RESOURCES });
      case 'resources/templates/list':
        // Pigma exposes concrete document resources only; the empty list is a
        // valid, spec-conformant answer for clients that probe for templates.
        return success(id, { resourceTemplates: [] });
      case 'resources/read': {
        const uri = params.uri;
        if (typeof uri !== 'string') return failure(id, ErrorCode.INVALID_PARAMS, 'resources/read requires a `uri`');
        try {
          return success(id, { contents: [readResource(uri)] });
        } catch (error) {
          return failure(id, ErrorCode.INVALID_PARAMS, error instanceof Error ? error.message : String(error));
        }
      }
      case 'prompts/list':
        return success(id, { prompts: PROMPTS });
      case 'prompts/get': {
        const promptName = params.name;
        const prompt = PROMPTS.find((entry) => entry.name === promptName);
        if (!prompt) return failure(id, ErrorCode.INVALID_PARAMS, `Unknown prompt "${String(promptName)}"`);
        return success(id, {
          description: prompt.description,
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: [
                  'Write a design-system rules file for this project that tells a coding agent how to translate designs into code.',
                  'Cover, using the Pigma MCP tools as the sources of truth:',
                  '- how to read a design: get_design_context for structure/styling, get_screenshot for layout fidelity, get_metadata to orient.',
                  '- which design tokens exist and how to apply them: get_variable_defs, search_design_system, get_libraries.',
                  '- how to reuse code components instead of re-creating them: get_code_connect_map, get_code_connect_suggestions, get_context_for_code_connect.',
                  '- the framework/styling conventions to emit (for example React + Tailwind) and any project-specific component paths.',
                  'Save the result to the correct rules/ or instructions/ path so the agent can load it during code generation.',
                ].join('\n'),
              },
            },
          ],
        });
      }
      default:
        return failure(id, ErrorCode.METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  };

  return {
    name,
    version,
    tools,
    handle: dispatch,
  };
}

