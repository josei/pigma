/**
 * Resources and prompts: the capabilities `initialize` advertises, exercised.
 *
 * An advertised capability that is never proven is the same class of claim as a
 * tool that does not work. This drives all five over the real SDK path and
 * requires each to end in (a) a well-formed MCP result or (b) a clear protocol
 * error — plus the cross-check that the advertised capability set and the
 * dispatcher's handlers agree in both directions.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { figmaRestToPigmaFile } from '../../src/figma/convert/convert';
import { parseFigmaRestFile } from '../../src/figma/rest/parse';
import type { PigmaFile } from '../../src/model/types';
import { createMcpServer } from '../../src/mcp/protocol';
import { startRelayServer, type RelayHandle } from '../../src/mcp/relay';
import { startHttpServer, type HttpServerHandle } from '../../src/mcp/transports/node';
import { FakeBrowser } from './fakeEditor';

vi.setConfig({ testTimeout: 60_000 });

function initialFile(): PigmaFile {
  const raw = JSON.parse(
    readFileSync(fileURLToPath(new URL('../figma/fixtures/rest-file.json', import.meta.url)), 'utf8'),
  ) as unknown;
  return figmaRestToPigmaFile(parseFigmaRestFile(raw), { now: () => 1 }).file;
}

/** What each advertised capability implies the dispatcher must handle. */
const CAPABILITY_METHODS: Record<string, string[]> = {
  tools: ['tools/list', 'tools/call'],
  resources: ['resources/list', 'resources/templates/list', 'resources/read'],
  prompts: ['prompts/list', 'prompts/get'],
  logging: ['logging/setLevel'],
};

const relays: RelayHandle[] = [];
const servers: HttpServerHandle[] = [];
const browsers: FakeBrowser[] = [];
const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close().catch(() => undefined)));
  for (const browser of browsers.splice(0)) browser.close();
  await Promise.all(servers.splice(0).map((server) => server.close().catch(() => undefined)));
  await Promise.all(relays.splice(0).map((relay) => relay.close().catch(() => undefined)));
});

async function connect(): Promise<Client> {
  const relay = await startRelayServer({ token: 'resources-token', commandTimeoutMs: 30_000 });
  relays.push(relay);
  const server = await startHttpServer(createMcpServer({ session: relay.session }));
  servers.push(server);
  const browser = new FakeBrowser(relay.url, relay.token, initialFile());
  browsers.push(browser);
  await browser.waitUntil(() => relay.status().connected);

  const client = new Client({ name: 'resources-harness', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(server.url)));
  clients.push(client);
  return client;
}

describe('resources', () => {
  it('lists the advertised resources, with the MCP shape', async () => {
    const client = await connect();
    const { resources } = await client.listResources();

    // Advertised means served: a capability that lists nothing is a defect.
    expect(resources.length).toBeGreaterThan(0);
    for (const resource of resources) {
      expect(typeof resource.uri).toBe('string');
      expect(resource.uri.length).toBeGreaterThan(0);
      expect(typeof resource.name).toBe('string');
      expect(typeof resource.mimeType).toBe('string');
    }
    expect(resources.map((resource) => resource.uri).sort()).toEqual([
      'pigma://document',
      'pigma://document/metadata',
      'pigma://document/selection',
    ]);
  });

  it('answers resource templates with a well-formed (empty) list', async () => {
    const client = await connect();
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(Array.isArray(resourceTemplates)).toBe(true);
    expect(resourceTemplates).toHaveLength(0);
  });

  it('reads a real resource, and the content follows the document', async () => {
    const client = await connect();

    const first = await client.readResource({ uri: 'pigma://document' });
    const firstContent = first.contents[0] as { uri: string; mimeType?: string; text?: string };
    expect(firstContent.uri).toBe('pigma://document');
    expect(firstContent.mimeType).toBe('application/json');
    const before = JSON.parse(firstContent.text ?? '{}') as PigmaFile;
    expect(before.schema).toBe('pigma/1');
    const beforeText = firstContent.text ?? '';

    // EDIT the document through a tool, then read the same resource again.
    const created = (await client.callTool({
      name: 'use_pigma',
      arguments: { code: "figma.createRectangle({ name: 'Resource proof', width: 12, height: 12 }).id;" },
    })) as { isError?: boolean; structuredContent?: { output?: string } };
    expect(created.isError).toBeFalsy();
    const nodeId = String(created.structuredContent?.output ?? '');
    expect(nodeId).not.toBe('');

    const second = await client.readResource({ uri: 'pigma://document' });
    const secondText = (second.contents[0] as { text?: string }).text ?? '';
    // The resource is not a cached snapshot: it changed with the document.
    expect(secondText).not.toBe(beforeText);
    expect(secondText).toContain(nodeId);
    expect(secondText).toContain('Resource proof');

    // The other two resources serve their own shapes.
    const metadata = await client.readResource({ uri: 'pigma://document/metadata' });
    const metadataContent = metadata.contents[0] as { mimeType?: string; text?: string };
    expect(metadataContent.mimeType).toBe('application/xml');
    expect(metadataContent.text).toContain('<node');

    const selection = await client.readResource({ uri: 'pigma://document/selection' });
    const selectionContent = selection.contents[0] as { mimeType?: string; text?: string };
    expect(selectionContent.mimeType).toBe('application/json');
    expect(() => JSON.parse(selectionContent.text ?? '')).not.toThrow();
  });

  it('answers an unknown uri with a clear protocol error, not a throw or an empty success', async () => {
    const client = await connect();
    await expect(client.readResource({ uri: 'pigma://nope' })).rejects.toMatchObject({ code: -32602 });
    await expect(client.readResource({ uri: 'pigma://nope' })).rejects.toThrow(/Unknown resource uri/i);
  });
});

describe('prompts', () => {
  it('lists the advertised prompt, with the MCP shape', async () => {
    const client = await connect();
    const { prompts } = await client.listPrompts();
    expect(prompts.length).toBeGreaterThan(0);
    const prompt = prompts.find((entry) => entry.name === 'create_design_system_rules');
    expect(prompt).toBeTruthy();
    expect(typeof prompt?.description).toBe('string');
    expect((prompt?.description ?? '').length).toBeGreaterThan(0);
    // The published prompt takes no arguments.
    expect(prompt?.arguments ?? []).toEqual([]);
  });

  it('renders the prompt as a user message', async () => {
    const client = await connect();
    const rendered = await client.getPrompt({ name: 'create_design_system_rules' });
    expect(Array.isArray(rendered.messages)).toBe(true);
    expect(rendered.messages.length).toBeGreaterThan(0);
    const message = rendered.messages[0] as { role?: string; content?: { type?: string; text?: string } };
    expect(message.role).toBe('user');
    expect(message.content?.type).toBe('text');
    expect((message.content?.text ?? '').length).toBeGreaterThan(0);
    expect(message.content?.text ?? '').toMatch(/design-system rules/i);
  });

  it('answers an unknown prompt with a clear protocol error', async () => {
    const client = await connect();
    await expect(client.getPrompt({ name: 'nope' })).rejects.toMatchObject({ code: -32602 });
    await expect(client.getPrompt({ name: 'nope' })).rejects.toThrow(/Unknown prompt/i);
  });
});

describe('advertised capabilities match the dispatcher', () => {
  it('has a handler for every advertised capability, and a capability for every handler', async () => {
    const client = await connect();
    const capabilities = client.getServerCapabilities() as Record<string, unknown> | undefined;
    expect(capabilities).toBeTruthy();
    const advertised = Object.keys(capabilities ?? {});
    expect(advertised.sort()).toEqual(['logging', 'prompts', 'resources', 'tools']);

    // A raw transport lets us probe methods the SDK does not wrap.
    const { url } = servers[servers.length - 1] as { url: string };
    const probe = async (method: string, params?: unknown): Promise<number | 'handled'> => {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params === undefined ? {} : { params }) }),
      });
      const body = (await response.json()) as { error?: { code?: number } };
      return body.error?.code === -32601 ? -32601 : 'handled';
    };

    // Forward: every advertised capability's methods are handled.
    for (const capability of advertised) {
      for (const method of CAPABILITY_METHODS[capability] ?? []) {
        expect(await probe(method, method === 'resources/read' ? { uri: 'pigma://document' } : undefined), `${capability}: ${method}`).toBe('handled');
      }
    }

    // Reverse: nothing is handled without an advertised capability.
    const handledWithoutCapability = Object.entries(CAPABILITY_METHODS)
      .filter(([capability]) => !advertised.includes(capability))
      .flatMap(([, methods]) => methods);
    for (const method of handledWithoutCapability) {
      expect(await probe(method), `${method} is handled but its capability is not advertised`).toBe(-32601);
    }

    // And the probe itself is meaningful: a method with no handler is -32601.
    expect(await probe('completions/complete')).toBe(-32601);
    expect(await probe('resources/subscribe', { uri: 'pigma://document' })).toBe(-32601);
  });
});
