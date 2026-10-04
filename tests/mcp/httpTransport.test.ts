/**
 * Hosted-mode surface for the Streamable HTTP transport: session tokens, the
 * status/health endpoint, and the harness config snippets.
 *
 * The token model is a capability, not an identity: mint per session, short TTL,
 * revocable, and off unless a store is wired in. Nothing here introduces a user.
 */
import { vi, afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { figmaRestToPigmaFile } from '../../src/figma/convert/convert';
import { parseFigmaRestFile } from '../../src/figma/rest/parse';
import { createMcpServer } from '../../src/mcp/protocol';
import { createSession } from '../../src/mcp/session';
import { nodeRasterizer } from '../../src/mcp/raster.node';
import { createHttpHandler } from '../../src/mcp/transports/http';
import { startHttpServer, type HttpServerHandle } from '../../src/mcp/transports/node';
import { DEFAULT_TOKEN_TTL_MS, TokenStore, looksLikeToken } from '../../src/mcp/tokens';
import { claudeConfig, codexConfig, cursorConfig, harnessConfigs } from '../../src/mcp/harnessConfig';
import { serveStdio } from '../../src/mcp/transports/stdio';

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

const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } };

function call(
  handler: (request: Request) => Promise<Response>,
  options: { method?: string; path?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Response> {
  const { method = 'POST', path = '/mcp', body, headers = {} } = options;
  return handler(
    new Request(`http://localhost${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

describe('hosted mode is off unless enabled', () => {
  it('serves JSON-RPC with no token at all', async () => {
    const handler = createHttpHandler(buildServer());
    const response = await call(handler, { body: initialize });
    expect(response.status).toBe(200);
    expect((await response.json()) as { result: { serverInfo: { name: string } } }).toMatchObject({
      result: { serverInfo: { name: 'pigma' } },
    });
  });

  it('reports no token requirement and offers no mint route', async () => {
    const handler = createHttpHandler(buildServer());
    const status = (await (await call(handler, { method: 'GET', path: '/mcp/status' })).json()) as {
      tokenRequired: boolean;
      mode: string;
      tokenTtlMs: number | null;
      sessions: unknown[];
    };
    expect(status).toMatchObject({ tokenRequired: false, mode: 'loopback', tokenTtlMs: null, sessions: [] });

    const mint = await call(handler, { path: '/mcp/token' });
    expect(mint.status).toBe(404);
  });
});

describe('session tokens', () => {
  it('requires a live token for every JSON-RPC request', async () => {
    const tokens = new TokenStore();
    const handler = createHttpHandler(buildServer(), { tokens, endpoint: 'http://localhost:3001/mcp' });

    const missing = await call(handler, { body: initialize });
    expect(missing.status).toBe(401);
    expect(missing.headers.get('www-authenticate')).toContain('Bearer');
    expect(await missing.text()).toContain('unknown');

    const unknown = await call(handler, { body: initialize, headers: { authorization: 'Bearer pigma_deadbeef' } });
    expect(unknown.status).toBe(401);
    expect(await unknown.text()).toContain('unknown');

    const session = tokens.mint(null);
    const bearer = await call(handler, { body: initialize, headers: { authorization: `Bearer ${session.token}` } });
    expect(bearer.status).toBe(200);

    // The header form is equivalent, and any harness may use it (no allowlist).
    const direct = await call(handler, {
      body: { ...initialize, params: { ...initialize.params, clientInfo: { name: 'some-unknown-harness', version: '9' } } },
      headers: { 'x-pigma-token': session.token },
    });
    expect(direct.status).toBe(200);
    const listed = await call(handler, {
      body: { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(((await listed.json()) as { result: { tools: unknown[] } }).result.tools.length).toBeGreaterThan(0);
  });

  it('rejects an expired token', async () => {
    let now = 1_000_000;
    const tokens = new TokenStore({ ttlMs: 1000, now: () => now });
    const handler = createHttpHandler(buildServer(), { tokens });
    const session = tokens.mint(null);

    expect((await call(handler, { body: initialize, headers: { authorization: `Bearer ${session.token}` } })).status).toBe(200);

    now += 1000;
    const expired = await call(handler, { body: initialize, headers: { authorization: `Bearer ${session.token}` } });
    expect(expired.status).toBe(401);
    expect(await expired.text()).toContain('expired');
  });

  it('rejects a revoked token immediately', async () => {
    const tokens = new TokenStore();
    const handler = createHttpHandler(buildServer(), { tokens });
    const session = tokens.mint(null);

    expect((await call(handler, { body: initialize, headers: { authorization: `Bearer ${session.token}` } })).status).toBe(200);

    const revoked = await call(handler, { method: 'DELETE', path: '/mcp/token', headers: { authorization: `Bearer ${session.token}` } });
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toEqual({ revoked: true });

    const after = await call(handler, { body: initialize, headers: { authorization: `Bearer ${session.token}` } });
    expect(after.status).toBe(401);
    expect(await after.text()).toContain('revoked');

    // Revoking an unknown token is a miss, not a success.
    expect((await call(handler, { method: 'DELETE', path: '/mcp/token' })).status).toBe(404);
  });

  it('mints per session from loopback, or with the operator mint secret', async () => {
    const tokens = new TokenStore({ ttlMs: DEFAULT_TOKEN_TTL_MS });
    const handler = createHttpHandler(buildServer(), {
      tokens,
      endpoint: 'https://mcp.example.com/mcp',
      mintSecret: 'operator-secret',
    });

    // A non-loopback peer without the secret cannot mint.
    const denied = await call(handler, { path: '/mcp/token', headers: { 'x-pigma-peer': '203.0.113.7' } });
    expect(denied.status).toBe(403);

    // With the secret it can (this is how a hosted operator hands out a session).
    const allowed = await call(handler, {
      path: '/mcp/token',
      headers: { 'x-pigma-peer': '203.0.113.7', 'x-pigma-mint': 'operator-secret' },
    });
    expect(allowed.status).toBe(201);
    const minted = (await allowed.json()) as { token: string; expiresAt: number; ttlMs: number; harnessConfig: Array<{ id: string }> };
    expect(looksLikeToken(minted.token)).toBe(true);
    expect(minted.ttlMs).toBe(DEFAULT_TOKEN_TTL_MS);
    expect(minted.harnessConfig.map((entry) => entry.id)).toEqual(['claude', 'cursor', 'codex']);

    // Loopback needs no secret.
    const loopback = await call(handler, { path: '/mcp/token', headers: { 'x-pigma-peer': '::ffff:127.0.0.1' } });
    expect(loopback.status).toBe(201);

    // Each mint is a distinct session.
    const second = (await loopback.json()) as { token: string };
    expect(second.token).not.toBe(minted.token);
    expect(tokens.sessions()).toHaveLength(2);
  });

  it('enforces the session cap on mint by evicting the oldest live session', () => {
    let now = 1000;
    const tokens = new TokenStore({ maxSessions: 3, now: () => now });
    const first = tokens.mint(null);
    now += 1;
    const second = tokens.mint(null);
    now += 1;
    const third = tokens.mint(null);
    expect(tokens.size).toBe(3);

    // Every record is live, so the cap is enforced by eviction, not pruning.
    now += 1;
    const fourth = tokens.mint(null);
    expect(tokens.size).toBe(3);
    expect(tokens.verify(first.token)).toMatchObject({ ok: false, reason: 'unknown' });
    expect(tokens.verify(second.token)).toMatchObject({ ok: true });
    expect(tokens.verify(third.token)).toMatchObject({ ok: true });
    expect(tokens.verify(fourth.token)).toMatchObject({ ok: true });

    // Dead records are reclaimed first, so a live session is not evicted while
    // an expired or revoked one is still occupying a slot.
    now += 1;
    const fifth = tokens.mint(null); // evicts second (oldest live)
    expect(tokens.size).toBe(3);
    tokens.revoke(fifth.token);
    now += 1;
    const sixth = tokens.mint(null);
    expect(tokens.size).toBe(3);
    expect(tokens.verify(sixth.token)).toMatchObject({ ok: true });
    // The revoked record went, not a live one.
    expect(tokens.verify(third.token)).toMatchObject({ ok: true });
    expect(tokens.verify(fourth.token)).toMatchObject({ ok: true });

    // And the cap holds through a stream of live sessions.
    for (let index = 0; index < 20; index += 1) {
      now += 1;
      tokens.mint(null);
    }
    expect(tokens.size).toBe(3);
    expect(tokens.sessions()).toHaveLength(3);
  });

  it('revokes every session at once (shutdown)', () => {
    const tokens = new TokenStore();
    const first = tokens.mint(null);
    const second = tokens.mint(null);
    expect(tokens.revokeAll()).toBe(2);
    expect(tokens.verify(first.token)).toMatchObject({ ok: false, reason: 'revoked' });
    expect(tokens.verify(second.token)).toMatchObject({ ok: false, reason: 'revoked' });
    expect(tokens.revokeAll()).toBe(0);
  });
});

describe('status surface', () => {
  it('describes the endpoint without ever leaking a token', async () => {
    const tokens = new TokenStore();
    const handler = createHttpHandler(buildServer(), { tokens, endpoint: 'https://mcp.example.com/mcp' });
    const session = tokens.mint('panel');

    const response = await call(handler, { method: 'GET', path: '/mcp/status' });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      transport: string;
      endpoint: string;
      mode: string;
      tokenRequired: boolean;
      tokenTtlMs: number;
      sessions: Array<{ sessionId: string; label: string | null; expired: boolean }>;
      harnessConfig: Array<{ id: string; content: string }>;
    };
    expect(body).toMatchObject({
      ok: true,
      transport: 'streamable-http',
      endpoint: 'https://mcp.example.com/mcp',
      mode: 'hosted',
      tokenRequired: true,
      tokenTtlMs: DEFAULT_TOKEN_TTL_MS,
    });
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0]).toMatchObject({ label: 'panel', expired: false });
    expect(body.harnessConfig.map((entry) => entry.id)).toEqual(['claude', 'cursor', 'codex']);
    // The raw token is never in the status payload.
    expect(JSON.stringify(body)).not.toContain(session.token);
  });

  it('is reachable without a token even in hosted mode', async () => {
    const tokens = new TokenStore();
    const handler = createHttpHandler(buildServer(), { tokens });
    expect((await call(handler, { method: 'GET', path: '/mcp/status' })).status).toBe(200);
  });
});

describe('harness config snippets', () => {
  it('emits the exact shape each harness expects', () => {
    const options = { endpoint: 'http://127.0.0.1:3001/mcp', token: 'pigma_abc' };

    expect(JSON.parse(claudeConfig(options).content)).toEqual({
      mcpServers: {
        pigma: {
          type: 'http',
          url: 'http://127.0.0.1:3001/mcp',
          headers: { Authorization: 'Bearer pigma_abc' },
        },
      },
    });
    expect(claudeConfig(options).path).toBe('.mcp.json');

    expect(JSON.parse(cursorConfig(options).content)).toEqual({
      mcpServers: { pigma: { url: 'http://127.0.0.1:3001/mcp', headers: { Authorization: 'Bearer pigma_abc' } } },
    });
    expect(cursorConfig(options).path).toBe('.cursor/mcp.json');

    // Codex is TOML, not JSON: [mcp_servers.<name>] with an http_headers table.
    expect(codexConfig(options).content).toBe(
      '[mcp_servers.pigma]\nurl = "http://127.0.0.1:3001/mcp"\n\n[mcp_servers.pigma.http_headers]\nAuthorization = "Bearer pigma_abc"\n',
    );
    expect(codexConfig(options).format).toBe('toml');
    expect(codexConfig(options).path).toBe('~/.codex/config.toml');
  });

  it('omits auth entirely when the endpoint needs no token', () => {
    const entries = harnessConfigs({ endpoint: 'http://127.0.0.1:3001/mcp' });
    for (const entry of entries) expect(entry.content).not.toContain('Authorization');
    expect(JSON.parse(entries[0]!.content)).toEqual({
      mcpServers: { pigma: { type: 'http', url: 'http://127.0.0.1:3001/mcp' } },
    });
    expect(entries[2]!.content).toBe('[mcp_servers.pigma]\nurl = "http://127.0.0.1:3001/mcp"\n');
  });

  it('uses the configured server name as the config key', () => {
    const entries = harnessConfigs({ endpoint: 'http://127.0.0.1:1/mcp', name: 'pigma-local' });
    expect(JSON.parse(entries[0]!.content).mcpServers['pigma-local']).toBeTruthy();
    expect(entries[2]!.content).toContain('[mcp_servers.pigma-local]');
  });
});

describe('the two transports coexist in one server', () => {
  const handles: HttpServerHandle[] = [];

  afterEach(async () => {
    for (const handle of handles.splice(0)) await handle.close();
  });

  it('serves HTTP with a token while stdio keeps working', async () => {
    const tokens = new TokenStore();
    const handle = await startHttpServer(buildServer(), { tokens, name: 'pigma' });
    handles.push(handle);
    expect(handle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    expect(handle.statusUrl).toBe(`${handle.url}/status`);

    // HTTP: refused without a token, served with one minted over the loopback.
    const refused = await fetch(handle.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(initialize),
    });
    expect(refused.status).toBe(401);

    const minted = await fetch(`${handle.url}/token`, { method: 'POST' });
    expect(minted.status).toBe(201);
    const { token } = (await minted.json()) as { token: string };

    const accepted = await fetch(handle.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(initialize),
    });
    expect(accepted.status).toBe(200);

    const status = (await (await fetch(handle.statusUrl)).json()) as { mode: string; tokenRequired: boolean };
    expect(status).toMatchObject({ mode: 'loopback', tokenRequired: true });

    // stdio: unchanged, and needs no token at all.
    const written: string[] = [];
    async function* input(): AsyncGenerator<string> {
      yield `${JSON.stringify(initialize)}\n`;
      yield `${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`;
    }
    await serveStdio(buildServer(), { input: input(), output: { write: (chunk) => written.push(chunk) } });
    expect(written).toHaveLength(2);
    expect(JSON.parse(written[1] as string)).toMatchObject({ id: 2 });
  });
});
