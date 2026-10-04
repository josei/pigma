import { vi, afterEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { PROJECT_ROOT, VITE_NODE_ENTRY } from './fixtures/spawn';
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { figmaRestToPigmaFile } from '../../src/figma/convert/convert';
import { parseFigmaRestFile } from '../../src/figma/rest/parse';
import { createMcpServer, type McpServer } from '../../src/mcp/protocol';
import { createSession } from '../../src/mcp/session';
import { nodeRasterizer } from '../../src/mcp/raster.node';
import { startHttpServer, type HttpServerHandle } from '../../src/mcp/transports/node';
import type { JsonRpcMessage } from '../../src/mcp/types';

/**
 * These tests drive real sockets, real HTTP and spawned processes. Their subject
 * is protocol behaviour, not latency, so they get a generous per-file bound: a
 * busy box must not turn a slow-but-correct round trip into a failure. It is
 * still a *bound* — a genuine hang fails here, with vitest naming the timeout.
 */
vi.setConfig({ testTimeout: 60_000 });

const circleFig = fileURLToPath(new URL('../figma/fixtures/circle.fig', import.meta.url));
const json = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../figma/fixtures/${name}`, import.meta.url)), 'utf8'));

/** SDK Transport that drives an in-process `McpServer` over its handle(). */
class HandleTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  private readonly server: McpServer;

  constructor(server: McpServer) {
    this.server = server;
  }

  async start(): Promise<void> {
    // Nothing to start: the server is in-process.
  }

  async send(message: JSONRPCMessage): Promise<void> {
    // JSONRPCMessage and JsonRpcMessage describe the same wire shape.
    const response = await this.server.handle(message as JsonRpcMessage);
    if (response) this.onmessage?.(response as JSONRPCMessage);
  }

  async close(): Promise<void> {
    this.onclose?.();
  }
}

function buildServer(): McpServer {
  const { file } = figmaRestToPigmaFile(parseFigmaRestFile(json('rest-file.json')), { now: () => 1 });
  return createMcpServer({ session: createSession(file), rasterizer: nodeRasterizer });
}

const openClients: Client[] = [];
const openHandles: HttpServerHandle[] = [];

afterEach(async () => {
  await Promise.all(openClients.splice(0).map((client) => client.close().catch(() => undefined)));
  await Promise.all(openHandles.splice(0).map((handle) => handle.close().catch(() => undefined)));
});

describe('MCP SDK interoperability', () => {
  it('an SDK client with an unknown harness name completes the handshake and tool discovery in-process', async () => {
    const client = new Client({ name: 'totally-unknown-harness-2031', version: '9.9.9' });
    openClients.push(client);
    await client.connect(new HandleTransport(buildServer()));

    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'get_design_context',
        'get_screenshot',
        'use_pigma',
        // Platform + Code Connect surface, discoverable by an unknown client.
        'whoami',
        'get_figjam',
        'generate_pigma_design',
        'generate_diagram',
        'get_code_connect_suggestions',
        'get_context_for_code_connect',
        'add_code_connect_map',
        'send_code_connect_mappings',
        'list_generative_plugins',
        'create_shader',
      ]),
    );

    // Capability tools answer explicitly (never fake success) for any client.
    const whoami = await client.callTool({ name: 'whoami', arguments: {} });
    expect(whoami.isError).toBe(true);

    const metadata = await client.callTool({ name: 'get_metadata', arguments: {} });
    expect(metadata.isError).toBeFalsy();

    const screenshot = await client.callTool({ name: 'get_screenshot', arguments: { nodeId: '1:2' } });
    const image = (screenshot.content as Array<{ type: string; mimeType: string; data: string }>)[0];
    expect(image?.mimeType).toBe('image/png');
    expect(Buffer.from(image?.data ?? '', 'base64').subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  it('a second unknown harness name can drive the same server', async () => {
    const client = new Client({ name: '', version: '0' });
    openClients.push(client);
    await client.connect(new HandleTransport(buildServer()));
    const pong = await client.ping();
    expect(pong).toBeDefined();
    const resources = await client.listResources();
    expect(resources.resources.map((resource) => resource.uri)).toContain('pigma://document');
    const prompts = await client.listPrompts();
    expect(prompts.prompts.map((prompt) => prompt.name)).toContain('create_design_system_rules');
  });

  it('an SDK client talks to the real Streamable HTTP server', async () => {
    const handle = await startHttpServer(buildServer());
    openHandles.push(handle);
    const client = new Client({ name: 'http-harness-unknown', version: '1.2.3' });
    openClients.push(client);
    await client.connect(new StreamableHTTPClientTransport(new URL(handle.url)));

    const tools = await client.listTools();
    expect(tools.tools.length).toBeGreaterThan(10);
    const metadata = await client.callTool({ name: 'get_metadata', arguments: { nodeId: '1:2' } });
    const text = (metadata.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
    expect(text).toContain('id="1:2"');
  });

  it('an SDK client spawns the real stdio CLI against a native .fig', async () => {
    const client = new Client({ name: 'stdio-harness-unknown', version: '0.0.1' });
    openClients.push(client);
    const transport = new StdioClientTransport({
      // Spawn vite-node directly (no npx wrapper) so closing the transport
      // terminates the actual worker instead of orphaning it.
      command: process.execPath,
      args: [VITE_NODE_ENTRY, 'src/mcp/bin.ts', '--file', circleFig],
      cwd: PROJECT_ROOT,
      stderr: 'pipe',
    });
    await client.connect(transport);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain('get_metadata');

    const metadata = await client.callTool({ name: 'get_metadata', arguments: {} });
    const text = (metadata.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
    expect(text).toContain('Page 1');

    const screenshot = await client.callTool({ name: 'get_screenshot', arguments: { nodeId: '1:3' } });
    const image = (screenshot.content as Array<{ type: string; mimeType: string; data: string }>)[0];
    expect(image?.mimeType).toBe('image/png');
  }, 60_000);
});
