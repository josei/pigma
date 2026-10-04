/**
 * Harness independence: the endpoint driven by a RAW JSON-RPC client.
 *
 * The parity suite uses the official MCP SDK. This one shares **no code** with
 * it — hand-written JSON over `fetch`, no SDK client, no SDK transport, no SDK
 * types — because the claim is that any harness that speaks the protocol works,
 * not just the one we test with.
 *
 * It also records the transcript, so the proof is the bytes on the wire.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { figmaRestToPigmaFile } from '../../src/figma/convert/convert';
import { parseFigmaRestFile } from '../../src/figma/rest/parse';
import type { PigmaFile } from '../../src/model/types';
import { createMcpServer } from '../../src/mcp/protocol';
import { startRelayServer, type RelayHandle } from '../../src/mcp/relay';
import { startHttpServer, type HttpServerHandle } from '../../src/mcp/transports/node';
import { allTools } from '../../src/mcp/tools/index';
import { FakeBrowser } from './fakeEditor';

vi.setConfig({ testTimeout: 60_000 });

function initialFile(): PigmaFile {
  const raw = JSON.parse(
    readFileSync(fileURLToPath(new URL('../figma/fixtures/rest-file.json', import.meta.url)), 'utf8'),
  ) as unknown;
  return figmaRestToPigmaFile(parseFigmaRestFile(raw), { now: () => 1 }).file;
}

/** One request/response pair, exactly as it went over the wire. */
interface Exchange {
  request: unknown;
  responseStatus: number;
  response: unknown;
  transport: 'json' | 'sse';
}

/**
 * A minimal JSON-RPC client: POST, read the body, done. `accept` selects the
 * reply shape the transport may use, which is how a real harness behaves.
 */
async function rpc(
  url: string,
  message: unknown,
  accept: 'application/json' | 'text/event-stream' = 'application/json',
): Promise<{ status: number; body: unknown; transport: 'json' | 'sse' }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept },
    body: JSON.stringify(message),
  });
  const text = await response.text();
  if (response.headers.get('content-type')?.includes('text/event-stream')) {
    // The transport answered with a single-message SSE stream: take its data frame.
    const data = text
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('');
    return { status: response.status, body: JSON.parse(data), transport: 'sse' };
  }
  return { status: response.status, body: text === '' ? null : JSON.parse(text), transport: 'json' };
}

const relays: RelayHandle[] = [];
const servers: HttpServerHandle[] = [];
const browsers: FakeBrowser[] = [];

afterEach(async () => {
  for (const browser of browsers.splice(0)) browser.close();
  await Promise.all(servers.splice(0).map((server) => server.close().catch(() => undefined)));
  await Promise.all(relays.splice(0).map((relay) => relay.close().catch(() => undefined)));
});

async function endpoint(): Promise<{ url: string; transcript: Exchange[] }> {
  const relay = await startRelayServer({ token: 'raw-token', commandTimeoutMs: 30_000 });
  relays.push(relay);
  const server = await startHttpServer(createMcpServer({ session: relay.session }));
  servers.push(server);
  const browser = new FakeBrowser(relay.url, relay.token, initialFile());
  browsers.push(browser);
  await browser.waitUntil(() => relay.status().connected);
  return { url: server.url, transcript: [] };
}

describe('a raw JSON-RPC harness with no SDK', () => {
  it('completes the handshake, lists the registry, and calls tools', async () => {
    const { url, transcript } = await endpoint();
    const record = (request: unknown, response: { status: number; body: unknown; transport: 'json' | 'sse' }): unknown => {
      transcript.push({ request, responseStatus: response.status, response: response.body, transport: response.transport });
      return response.body;
    };

    // 1. initialize — a client name the server has never seen, and a protocol
    //    version it may not know: no whitelist, no version pin.
    const initialize = await rpc(
      url,
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'hand-written-harness-9c1f', version: '0.0.1' },
        },
      },
    );
    record({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'hand-written-harness-9c1f' } } }, initialize);
    expect(initialize.status).toBe(200);
    const hello = initialize.body as { result?: { serverInfo?: { name?: string }; capabilities?: Record<string, unknown> } };
    expect(hello.result?.serverInfo?.name).toBe('pigma');
    expect(hello.result?.capabilities).toBeTruthy();

    // 2. initialized notification — a notification has no reply.
    const notified = await rpc(url, { jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(notified.status).toBe(202);
    expect(notified.body).toBeNull();

    // 3. tools/list — the whole registry, by name.
    const listed = await rpc(url, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    record({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, listed);
    const tools = (listed.body as { result?: { tools?: Array<{ name: string; inputSchema: unknown }> } }).result?.tools ?? [];
    expect(tools.map((tool) => tool.name).sort()).toEqual(allTools.map((tool) => tool.definition.name).sort());
    expect(tools).toHaveLength(35);
    // The schemas travel with the tools: a harness builds its arguments from them.
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} has no inputSchema on the wire`).toMatchObject({ type: 'object' });
    }

    // 4. tools/call — a real result (a)…
    const called = await rpc(url, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'get_metadata', arguments: { nodeId: '1:2' } },
    });
    record({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_metadata', arguments: { nodeId: '1:2' } } }, called);
    const metadata = (called.body as { result?: { isError?: boolean; content?: Array<{ text?: string }> } }).result;
    expect(metadata?.isError).toBeFalsy();
    expect(metadata?.content?.[0]?.text).toContain('<node');

    // 5. …and an explicit capability error (b), same hand-written client.
    const unsupported = await rpc(url, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'whoami', arguments: {} },
    });
    record({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'whoami', arguments: {} } }, unsupported);
    const whoami = (unsupported.body as { result?: { isError?: boolean; structuredContent?: { supported?: boolean; reason?: string } } }).result;
    expect(whoami?.isError).toBe(true);
    expect(whoami?.structuredContent?.supported).toBe(false);
    expect(whoami?.structuredContent?.reason).toBeTruthy();

    // 6. The same endpoint answers a harness that only accepts SSE, with the
    //    same JSON-RPC payload — the transport is not part of the contract.
    const sse = await rpc(url, { jsonrpc: '2.0', id: 5, method: 'tools/list' }, 'text/event-stream');
    expect(sse.transport).toBe('sse');
    record({ jsonrpc: '2.0', id: 5, method: 'tools/list' }, sse);
    expect(((sse.body as { result?: { tools?: unknown[] } }).result?.tools ?? [])).toHaveLength(35);

    // 7. Unknown methods are answered, not dropped.
    const unknown = await rpc(url, { jsonrpc: '2.0', id: 6, method: 'does/not/exist' });
    expect((unknown.body as { error?: { code?: number } }).error?.code).toBe(-32601);

    // The transcript is the evidence: five requests, five replies.
    expect(transcript.length).toBeGreaterThanOrEqual(5);
    expect(transcript.every((entry) => entry.responseStatus === 200 || entry.responseStatus === 202)).toBe(true);
  });
});


describe('a raw JSON-RPC harness reads resources and prompts', () => {
  it('lists, reads, and re-reads a resource that follows the document', async () => {
    const { url } = await endpoint();

    // resources/list — the capability is advertised, so it must serve something.
    const listed = await rpc(url, { jsonrpc: '2.0', id: 10, method: 'resources/list' });
    const resources = ((listed.body as { result?: { resources?: Array<{ uri: string; name: string; mimeType: string }> } }).result
      ?.resources ?? []);
    expect(resources.length).toBeGreaterThan(0);
    for (const resource of resources) {
      expect(typeof resource.uri).toBe('string');
      expect(typeof resource.name).toBe('string');
      expect(typeof resource.mimeType).toBe('string');
    }
    expect(resources.map((resource) => resource.uri)).toContain('pigma://document');

    // resources/templates/list — part of the same capability.
    const templates = await rpc(url, { jsonrpc: '2.0', id: 11, method: 'resources/templates/list' });
    expect((templates.body as { result?: { resourceTemplates?: unknown[] } }).result?.resourceTemplates).toEqual([]);

    // resources/read of a REAL resource: the MCP contents shape.
    const first = await rpc(url, { jsonrpc: '2.0', id: 12, method: 'resources/read', params: { uri: 'pigma://document' } });
    const firstContents = ((first.body as { result?: { contents?: Array<{ uri: string; mimeType: string; text: string }> } }).result
      ?.contents ?? []);
    expect(firstContents).toHaveLength(1);
    expect(firstContents[0]?.uri).toBe('pigma://document');
    expect(firstContents[0]?.mimeType).toBe('application/json');
    const before = firstContents[0]?.text ?? '';
    expect(JSON.parse(before)).toMatchObject({ schema: 'pigma/1' });

    // EDIT through the same hand-written client, then read the resource again.
    const created = await rpc(url, {
      jsonrpc: '2.0',
      id: 13,
      method: 'tools/call',
      params: { name: 'use_pigma', arguments: { code: "figma.createRectangle({ name: 'Raw resource proof', width: 5, height: 5 }).id;" } },
    });
    const nodeId = String(
      (created.body as { result?: { structuredContent?: { output?: string } } }).result?.structuredContent?.output ?? '',
    );
    expect(nodeId).not.toBe('');

    const second = await rpc(url, { jsonrpc: '2.0', id: 14, method: 'resources/read', params: { uri: 'pigma://document' } });
    const after = ((second.body as { result?: { contents?: Array<{ text: string }> } }).result?.contents ?? [])[0]?.text ?? '';
    expect(after).not.toBe(before);
    expect(after).toContain('Raw resource proof');

    // An UNKNOWN uri is a clear protocol error: not a throw, not an empty success.
    const unknown = await rpc(url, { jsonrpc: '2.0', id: 15, method: 'resources/read', params: { uri: 'pigma://nope' } });
    const error = (unknown.body as { error?: { code: number; message: string } }).error;
    expect(error?.code).toBe(-32602);
    expect(error?.message).toMatch(/Unknown resource uri/i);
    expect((unknown.body as { result?: unknown }).result).toBeUndefined();

    // prompts/list and prompts/get — advertised means served.
    const prompts = await rpc(url, { jsonrpc: '2.0', id: 16, method: 'prompts/list' });
    const listedPrompts = ((prompts.body as { result?: { prompts?: Array<{ name: string; description: string }> } }).result
      ?.prompts ?? []);
    expect(listedPrompts.length).toBeGreaterThan(0);
    expect(listedPrompts[0]?.name).toBe('create_design_system_rules');
    expect((listedPrompts[0]?.description ?? '').length).toBeGreaterThan(0);

    const rendered = await rpc(url, {
      jsonrpc: '2.0',
      id: 17,
      method: 'prompts/get',
      params: { name: 'create_design_system_rules' },
    });
    const messages = ((rendered.body as { result?: { messages?: Array<{ role: string; content: { type: string; text: string } }> } })
      .result?.messages ?? []);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]?.role).toBe('user');
    expect(messages[0]?.content.type).toBe('text');
    expect((messages[0]?.content.text ?? '').length).toBeGreaterThan(0);

    const unknownPrompt = await rpc(url, { jsonrpc: '2.0', id: 18, method: 'prompts/get', params: { name: 'nope' } });
    expect((unknownPrompt.body as { error?: { code?: number } }).error?.code).toBe(-32602);
  });
});
