/**
 * The deployment config surface (`GET /config.json`) and the MCP endpoint a
 * self-host mounts beside the relay.
 *
 * The contract under test: a controllable deployment (desktop loopback or
 * self-hosted server) advertises where its MCP endpoint is, the app can then use
 * that URL, and nothing secret is ever in the payload.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDeployment, type Deployment, type DeploymentOptions } from '../../server/deployment';
import { allTools } from '../../src/mcp/tools/index';
import { resolveLimits } from '../../src/collab/limits';
import { CONFIG_SCHEMA, buildConfig, containsSecret, serializeConfig } from '../../server/config';
import { parseRelayArgs } from '../../server/args';
import { TestClient } from './harness';


describe('config shape', () => {
  it('advertises the MCP endpoint, the relay, and no secrets', () => {
    const config = buildConfig({
      relayUrl: 'ws://127.0.0.1:8080/collab',
      relayTokenRequired: false,
      mcpUrl: 'http://127.0.0.1:8080/mcp',
      mcpTokenRequired: true,
      stdioAvailable: true,
    });
    expect(config).toEqual({
      schema: CONFIG_SCHEMA,
      name: 'pigma',
      version: '0.1.0',
      mode: 'loopback',
      mcp: { enabled: true, url: 'http://127.0.0.1:8080/mcp', tokenRequired: true, stdioAvailable: true },
      bridge: { enabled: false, path: '/bridge' },
      relay: { url: 'ws://127.0.0.1:8080/collab', tokenRequired: false, e2e: true },
    });
    // A required token is a boolean, never the value.
    expect(containsSecret(config, 'sekret')).toBe(false);
    expect(JSON.stringify(config)).not.toMatch(/secret|password|key/i);
  });

  it('reports MCP as disabled with no URL when it is not served here', () => {
    const config = buildConfig({ relayUrl: 'ws://127.0.0.1:8080/collab' });
    expect(config.mcp).toEqual({ enabled: false, tokenRequired: false, stdioAvailable: false });
    expect(config.mcp.url).toBeUndefined();
    expect(config.bridge).toEqual({ enabled: false, path: '/bridge' });
    // No endpoint URL is advertised anywhere when MCP is off.
    expect(JSON.stringify(config)).not.toMatch(/"url":"[^"]*\/mcp/);
  });

  it('labels a non-loopback deployment as a server', () => {
    expect(buildConfig({ relayUrl: 'wss://rooms.example.com/collab' }).mode).toBe('server');
    expect(buildConfig({ relayUrl: 'wss://rooms.example.com/collab', mcpUrl: 'https://mcp.example.com/mcp' }).mode).toBe('server');
  });

  it('serializes deterministically and never includes a secret it was given', () => {
    const json = serializeConfig(buildConfig({ relayUrl: 'ws://127.0.0.1:1/collab', mcpUrl: 'http://127.0.0.1:1/mcp', mcpTokenRequired: true }));
    expect(json.endsWith('\n')).toBe(true);
    expect(JSON.parse(json)).toMatchObject({ schema: CONFIG_SCHEMA, mcp: { tokenRequired: true } });
    expect(containsSecret(JSON.parse(json), 'pigma_deadbeef')).toBe(false);
  });
});

describe('config flags', () => {
  it('parses the MCP options and keeps MCP off unless asked for', () => {
    const off = parseRelayArgs([], {});
    expect(off).toMatchObject({ mcp: false, mcpPath: '/mcp' });
    expect(off.mcpToken).toBeUndefined();

    expect(parseRelayArgs(['--mcp'], {})).toMatchObject({ mcp: true, mcpPath: '/mcp' });
    expect(parseRelayArgs(['--mcp', '--mcp-token', 'sekret', '--mcp-path', '/mcp-alt'], {})).toMatchObject({
      mcp: true,
      mcpToken: 'sekret',
      mcpPath: '/mcp-alt',
    });
    // Environment is the fallback, flags win.
    expect(parseRelayArgs([], { PIGMA_MCP_ENABLED: '1', PIGMA_MCP_TOKEN: 'env-token' })).toMatchObject({ mcp: true, mcpToken: 'env-token' });
    expect(parseRelayArgs(['--mcp-token', 'flag-token'], { PIGMA_MCP_TOKEN: 'env-token' }).mcpToken).toBe('flag-token');
  });
});

describe('a self-hosted deployment', () => {
  const running: Array<{ close(): Promise<void> }> = [];
  let dataDir: string | null = null;

  afterEach(async () => {
    for (const deployment of running.splice(0)) await deployment.close();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    dataDir = null;
  });

  /**
   * Start the real deployment wiring in-process. The subject here is the config
   * surface and the mounted MCP endpoint, not the CLI: spawning `vite-node` costs
   * seconds under load, which made these tests time out on a busy machine.
   */
  async function startDeploymentFor(args: Partial<DeploymentOptions> = {}): Promise<Deployment> {
    dataDir = await mkdtemp(join(tmpdir(), 'pigma-config-'));
    const deployment = await startDeployment({
      port: 0,
      host: '127.0.0.1',
      dataDir,
      limits: resolveLimits({}),
      mcp: false,
      mcpPath: '/mcp',
      bridge: false,
      bridgePath: '/bridge',
      ...args,
    });
    running.push(deployment);
    return deployment;
  }

  it('serves /config.json with no MCP endpoint when MCP is disabled', async () => {
    const deployment = await startDeploymentFor();

    const response = await fetch(`http://127.0.0.1:${deployment.port}/config.json`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const config = (await response.json()) as { mcp: { enabled: boolean; url?: string }; relay: { url: string }; bridge: { enabled: boolean } };
    expect(config.mcp).toEqual({ enabled: false, tokenRequired: false, stdioAvailable: true });
    expect(config.mcp.url).toBeUndefined();
    expect(config.bridge).toEqual({ enabled: false, path: '/bridge' });
    expect(config.relay.url).toBe(`ws://127.0.0.1:${deployment.port}/collab`);

    // The relay the config advertises is real.
    const client = await TestClient.connect(`${config.relay.url}?room=advertised`);
    client.send({ t: 'hello', clientId: 'cfg-a', nickname: 'Ada' });
    expect(await client.next('welcome')).toMatchObject({ room: 'advertised' });
    client.close();

    // MCP is not served, so its path is an ordinary 404.
    expect((await fetch(`http://127.0.0.1:${deployment.port}/mcp`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${deployment.port}/mcp/status`)).status).toBe(404);
  });

  it('advertises a working MCP endpoint and serves it on the same port', async () => {
    const deployment = await startDeploymentFor({ mcp: true });
    const advertised = `http://127.0.0.1:${deployment.port}/mcp`;
    expect(deployment.config.mcp).toMatchObject({ enabled: true, url: advertised, tokenRequired: false });

    // The advertised URL is the endpoint: the same Streamable HTTP transport the
    // desktop loopback build serves answers here.
    const initialize = await fetch(advertised, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }),
    });
    expect(initialize.status).toBe(200);
    const body = (await initialize.json()) as { result: { serverInfo: { name: string }; capabilities: { tools: unknown } } };
    expect(body.result.serverInfo.name).toBe('pigma');
    expect(body.result.capabilities.tools).toBeTruthy();

    // …and the status surface, harness config included, is there too.
    const status = (await (await fetch(`${advertised}/status`)).json()) as {
      endpoint: string;
      tokenRequired: boolean;
      harnessConfig: unknown[];
      state: string;
      toolCount: number;
    };
    expect(status).toMatchObject({ endpoint: advertised, tokenRequired: false, state: 'self-hosted' });
    expect(status.harnessConfig).toHaveLength(3);
    // The advertised count is the registry's, and it matches what clients get.
    expect(status.toolCount).toBe(allTools.length);
    const listed = await fetch(advertised, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list' }),
    });
    expect(((await listed.json()) as { result: { tools: unknown[] } }).result.tools).toHaveLength(status.toolCount);

    const tools = await fetch(advertised, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });
    expect(((await tools.json()) as { result: { tools: unknown[] } }).result.tools.length).toBeGreaterThan(0);
  });

  it('requires the deployment token without ever advertising it', async () => {
    const deployment = await startDeploymentFor({ mcp: true, mcpToken: 'sekret-token' });
    const advertised = `http://127.0.0.1:${deployment.port}/mcp`;
    expect(deployment.configJson).not.toContain('sekret-token');
    expect(deployment.config.mcp.tokenRequired).toBe(true);

    const call = (token?: string) =>
      fetch(advertised, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      });
    expect((await call()).status).toBe(401);
    expect((await call('wrong')).status).toBe(401);
    expect((await call('sekret-token')).status).toBe(200);
  });
});
