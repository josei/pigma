/**
 * Tool-count honesty: the registry is the single source of truth, and what a
 * state advertises is a pure function of the registry plus the state.
 *
 * These tests fail on any drift — a tool added or removed, a name changed, or a
 * count hard-coded anywhere that disagrees with the registry.
 */
import { describe, expect, it } from 'vitest';
import { allTools } from '../../src/mcp/tools/index';
import {
  advertisedTools,
  isServiceable,
  toolCount,
  toolNames,
  DESKTOP_STATE,
  HOSTED_STATE,
  SELF_HOSTED_STATE,
  type McpState,
} from '../../src/mcp/toolCatalog';
import { createMcpServer } from '../../src/mcp/protocol';
import { createSession } from '../../src/mcp/session';
import type { RegisteredTool } from '../../src/mcp/registry';
import type { JsonRpcResponse } from '../../src/mcp/types';

/** The `result` of a JSON-RPC response, or null when it failed. */
function resultOf(response: JsonRpcResponse | null): Record<string, unknown> | null {
  if (!response || !('result' in response)) return null;
  return response.result as Record<string, unknown>;
}

/**
 * The published catalog, pinned by name. This is the exact set Figma publishes
 * (18 read + 11 write + 6 Weave) and the exact set `tools/list` returns; adding
 * or removing a tool must be a deliberate edit here.
 */
const PUBLISHED_TOOL_NAMES = [
  'add_code_connect_map',
  'create_generative_plugin',
  'create_new_file',
  'create_shader',
  'download_assets',
  'generate_diagram',
  'generate_pigma_design',
  'get_code_connect_map',
  'get_code_connect_suggestions',
  'get_context_for_code_connect',
  'get_design_context',
  'get_figjam',
  'get_generative_plugin',
  'get_libraries',
  'get_metadata',
  'get_motion_context',
  'get_screenshot',
  'get_shader',
  'get_variable_defs',
  'list_file_shaders',
  'list_generative_plugins',
  'list_shaders',
  'search_design_system',
  'send_code_connect_mappings',
  'update_generative_plugin',
  'update_shader',
  'upload_assets',
  'use_pigma',
  'weave_cancel_tool_run',
  'weave_get_tool_inputs',
  'weave_get_tool_run_output',
  'weave_list_tools',
  'weave_run_tool',
  'weave_upload_asset',
  'whoami',
];

describe('the registry is the single source of truth', () => {
  it('exposes exactly the published tool set', () => {
    expect(toolNames(allTools)).toEqual(PUBLISHED_TOOL_NAMES);
    expect(toolCount(allTools)).toBe(PUBLISHED_TOOL_NAMES.length);
    expect(allTools).toHaveLength(PUBLISHED_TOOL_NAMES.length);
  });

  it('has no duplicate names and a usable definition for each tool', () => {
    const names = toolNames(allTools);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of allTools) {
      expect(tool.definition.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect((tool.definition.title ?? '').length).toBeGreaterThan(0);
      expect(tool.definition.description.length).toBeGreaterThan(0);
      expect(tool.definition.inputSchema).toMatchObject({ type: 'object' });
      expect(typeof tool.handler).toBe('function');
    }
  });

  it('serves the registry over the wire: tools/list matches the registry exactly', async () => {
    const server = createMcpServer({ session: createSession(null) });
    const response = await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const listed = ((resultOf(response)?.tools ?? []) as Array<{ name: string }>).map((tool) => tool.name).sort();
    expect(listed).toEqual(toolNames(allTools));
    expect(server.tools).toHaveLength(toolCount(allTools));
  });
});

describe('what each state advertises', () => {
  const states: Array<[string, McpState]> = [
    ['hosted', HOSTED_STATE],
    ['self-hosted', SELF_HOSTED_STATE],
    ['desktop (shell present)', DESKTOP_STATE],
    ['desktop (no shell)', { kind: 'desktop', shellPresent: false }],
  ];

  it('advertises the whole registry in every state today', () => {
    // No registered tool requires the shell, so the counts coincide — asserted
    // per state so a future gated tool changes exactly one of these numbers.
    for (const [label, state] of states) {
      const advertised = advertisedTools(allTools, state);
      expect(`${label}: ${toolCount(advertised)}`).toBe(`${label}: ${PUBLISHED_TOOL_NAMES.length}`);
      expect(toolNames(advertised)).toEqual(PUBLISHED_TOOL_NAMES);
    }
  });

  it('never advertises a tool that cannot work in the state', () => {
    for (const [, state] of states) {
      for (const tool of advertisedTools(allTools, state)) {
        expect(isServiceable(tool, state)).toBe(true);
      }
    }
  });

  it('gates a shell-only tool out of every state without the shell', () => {
    // The mechanism, proven on a synthetic catalog: this is what a future
    // shell-only tool would do, and what these tests would then catch.
    const shellOnly: RegisteredTool = {
      definition: {
        name: 'open_in_desktop',
        title: 'Open in desktop',
        description: 'Synthetic: only the desktop shell can serve this.',
        inputSchema: { type: 'object' },
        requiresShell: true,
      },
      handler: () => ({ content: [{ type: 'text', text: 'ok' }] }),
    };
    const catalog = [...allTools, shellOnly];

    expect(toolNames(advertisedTools(catalog, DESKTOP_STATE))).toContain('open_in_desktop');
    for (const state of [HOSTED_STATE, SELF_HOSTED_STATE, { kind: 'desktop', shellPresent: false } as McpState]) {
      const advertised = advertisedTools(catalog, state);
      expect(advertised.map((tool) => tool.definition.name)).not.toContain('open_in_desktop');
      expect(toolCount(advertised)).toBe(allTools.length);
      // …and nothing that *is* advertised would fail on arrival.
      for (const tool of advertised) expect(isServiceable(tool, state)).toBe(true);
    }
  });

  it('reflects the state in the server it builds', async () => {
    const desktop = createMcpServer({ session: createSession(null), state: DESKTOP_STATE });
    const hosted = createMcpServer({ session: createSession(null), state: HOSTED_STATE });
    expect(toolCount(desktop.tools)).toBe(allTools.length);
    expect(toolCount(hosted.tools)).toBe(allTools.length);
    // Both still answer with the registry's names.
    const listed = await hosted.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect((resultOf(listed)?.tools as unknown[])).toHaveLength(allTools.length);
  });
});
