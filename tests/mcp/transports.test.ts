import { vi, describe, expect, it } from 'vitest';
import { request as httpRequest } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { figmaRestToPigmaFile } from '../../src/figma/convert/convert';
import { parseFigmaRestFile } from '../../src/figma/rest/parse';
import { createMcpServer } from '../../src/mcp/protocol';
import { createSession } from '../../src/mcp/session';
import { nodeRasterizer } from '../../src/mcp/raster.node';
import { serveStdio } from '../../src/mcp/transports/stdio';
import { createHttpHandler } from '../../src/mcp/transports/http';
import { startHttpServer, type HttpServerHandle } from '../../src/mcp/transports/node';

/**
 * These tests drive real sockets, real HTTP and spawned processes. Their subject
 * is protocol behaviour, not latency, so they get a generous per-file bound: a
 * busy box must not turn a slow-but-correct round trip into a failure. It is
 * still a *bound* — a genuine hang fails here, with vitest naming the timeout.
 */
vi.setConfig({ testTimeout: 60_000 });

const json = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../figma/fixtures/${name}`, import.meta.url)), 'utf8'));

function buildServer() {
  const { file } = figmaRestToPigmaFile(parseFigmaRestFile(json('rest-file.json')), { now: () => 1_700_000_000_000 });
  return createMcpServer({ session: createSession(file), rasterizer: nodeRasterizer });
}

async function* lines(...values: string[]): AsyncGenerator<string> {
  for (const value of values) yield `${value}\n`;
}

describe('stdio transport', () => {
  it('answers newline-delimited requests and ignores notifications', async () => {
    const server = buildServer();
    const written: string[] = [];
    await serveStdio(server, {
      input: lines(
        JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }),
        JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
        JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
      ),
      output: { write: (chunk) => written.push(chunk) },
    });
    expect(written).toHaveLength(2);
    const responses = written.map((line) => JSON.parse(line) as { id: number; result?: unknown; error?: unknown });
    expect(responses[0]?.id).toBe(1);
    expect(responses[1]?.id).toBe(2);
    expect((responses[1]?.result as { tools: unknown[] }).tools.length).toBeGreaterThan(0);
  });

  it('reports a parse error without crashing', async () => {
    const server = buildServer();
    const written: string[] = [];
    await serveStdio(server, { input: lines('{not json'), output: { write: (chunk) => written.push(chunk) } });
    expect(JSON.parse(written[0] ?? '{}')).toMatchObject({ error: { code: -32700 } });
  });
});

describe('streamable HTTP transport', () => {
  const post = (handler: (request: Request) => Promise<Response>, body: unknown, accept?: string) =>
    handler(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: accept ? { 'content-type': 'application/json', accept } : { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );

  it('answers a POST with JSON', async () => {
    const handler = createHttpHandler(buildServer());
    const response = await post(handler, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    const payload = (await response.json()) as { result: { serverInfo: { name: string } } };
    expect(payload.result.serverInfo.name).toBe('pigma');
  });

  it('answers a POST with SSE when the client only accepts text/event-stream', async () => {
    const handler = createHttpHandler(buildServer());
    const response = await post(handler, { jsonrpc: '2.0', id: 7, method: 'tools/list' }, 'text/event-stream');
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const text = await response.text();
    expect(text).toContain('event: message');
    expect(text).toContain('"id":7');
  });

  it('accepts notification-only POSTs with 202 and rejects bad methods', async () => {
    const handler = createHttpHandler(buildServer());
    const notification = await post(handler, { jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(notification.status).toBe(202);

    const get = await handler(new Request('http://localhost/mcp', { method: 'GET' }));
    expect(get.status).toBe(405);

    const del = await handler(new Request('http://localhost/mcp', { method: 'DELETE' }));
    expect(del.status).toBe(204);

    const malformed = await handler(
      new Request('http://localhost/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' }),
    );
    expect(malformed.status).toBe(400);
  });

  it('rejects a disallowed Origin and never sends wildcard CORS', async () => {
    const handler = createHttpHandler(buildServer());
    const blocked = await handler(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
      }),
    );
    expect(blocked.status).toBe(403);

    const allowed = await handler(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }),
      }),
    );
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('access-control-allow-origin')).toBe('http://localhost');
    expect(allowed.headers.get('access-control-allow-origin')).not.toBe('*');
  });

  it('rejects a disallowed Host header (DNS rebinding)', async () => {
    const server = buildServer();
    const handle: HttpServerHandle = await startHttpServer(server);
    try {
      const status = await new Promise<number>((resolve, reject) => {
        const req = httpRequest(
          { host: '127.0.0.1', port: handle.port, path: '/mcp', method: 'POST', headers: { host: 'evil.example', 'content-type': 'application/json' } },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on('error', reject);
        req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }));
      });
      expect(status).toBe(403);
    } finally {
      await handle.close();
    }
  });

  it('serves a real HTTP round trip', async () => {
    const handle: HttpServerHandle = await startHttpServer(buildServer());
    try {
      const response = await fetch(handle.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_metadata', arguments: {} } }),
      });
      expect(response.status).toBe(200);
      const payload = (await response.json()) as { result: { structuredContent: { pages: unknown[] } } };
      expect(payload.result.structuredContent.pages.length).toBeGreaterThan(0);
    } finally {
      await handle.close();
    }
  });
});
