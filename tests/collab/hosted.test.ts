/**
 * The no-log / no-store policy for MCP traffic, and the hosted deployment.
 *
 * Direction (recorded in `docs/ROADMAP.md`): the hosted site serves a fully
 * working MCP endpoint through the relay, which means the server *sees* tool
 * calls. It must therefore log nothing and store nothing of them: no payload in
 * any log line (error paths included), no file or database write, and a metrics
 * surface that is aggregate-only.
 *
 * These tests drive a real tools/call carrying a distinctive marker through the
 * real hosted entry point and then inspect every channel that could leak it: the
 * process's stdout and stderr, every file under the data directory, and the
 * health/metrics responses.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TestClient } from './harness';
import { FakeBrowser } from '../mcp/fakeEditor';
import { emptyFile } from '../../src/model/validate';
import { allTools } from '../../src/mcp/tools/index';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const viteNode = `${repoRoot}node_modules/.bin/vite-node`;

/** A marker that must never appear in a log line or on disk. */
const MARKER = 'MARKER-NEVER-LOGGED-4f7c1a';
/** A document that must never be written anywhere by the MCP path. */
const DOCUMENT_MARKER = 'DOCUMENT-NEVER-STORED-9b2e';

interface HostedRelay {
  child: ChildProcess;
  port: number;
  config: { mcp?: { url?: string }; relay: { url: string }; bridge: { enabled: boolean; path: string } };
  stdout(): string;
  stderr(): string;
}

/** Wait until the bridge reports a connected editor. */
async function waitForBridge(hosted: HostedRelay, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = (await (await fetch(`http://127.0.0.1:${hosted.port}/bridge/status`)).json()) as { connected: boolean };
    if (status.connected) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('no editor connected to the bridge');
}

/** The bridge token the operator sees on stdout (never in the config). */
function bridgeTokenOf(hosted: HostedRelay): string {
  const match = /bridge endpoint: http:\/\/[^\s]+\/bridge\/events\?token=([0-9a-f]+)/.exec(hosted.stdout());
  if (!match) throw new Error(`no bridge endpoint in the banner: ${hosted.stdout()}`);
  return match[1] as string;
}

describe('hosted deployment: no log, no store', () => {
  let relay: HostedRelay | null = null;
  let dataDir: string | null = null;
  const editors: FakeBrowser[] = [];

  afterEach(async () => {
    for (const editor of editors.splice(0)) editor.close();
    const child = relay?.child;
    relay = null;
    if (child) {
      // Wait for the process to be gone before touching its data dir: a SIGKILLed
      // server can still be mid-write, and removing the directory underneath it
      // races that write (the ENOTEMPTY flake this suite used to have).
      await new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve();
        child.once('exit', () => resolve());
        child.kill('SIGKILL');
      });
    }
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    dataDir = null;
  });

  async function startHosted(args: string[] = []): Promise<HostedRelay> {
    dataDir = await mkdtemp(join(tmpdir(), 'pigma-hosted-'));
    const child = spawn(
      viteNode,
      ['server/index.ts', '--port', '0', '--host', '127.0.0.1', '--data-dir', dataDir as string, '--hosted', ...args],
      { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    let err = '';
    child.stdout?.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
    child.stderr?.on('data', (chunk: Buffer) => (err += chunk.toString('utf8')));

    const ready = await new Promise<{ port: number; config: string }>((resolve, reject) => {
      const timer = setInterval(() => {
        const match = /relay ready (\{[^}]*\})/.exec(out);
        if (match) {
          clearInterval(timer);
          resolve(JSON.parse(match[1] as string) as { port: number; config: string });
        }
      }, 100);
      child.once('exit', (code) => reject(new Error(`hosted relay exited early (${code}): ${err}`)));
      setTimeout(() => reject(new Error(`no ready line: ${out}${err}`)), 30_000);
    });

    const config = (await (await fetch(ready.config)).json()) as HostedRelay['config'];
    relay = { child, port: ready.port, config, stdout: () => out, stderr: () => err };
    return relay;
  }

  /** Mint a session token over loopback (the panel's path). */
  async function mint(hosted: HostedRelay): Promise<string> {
    const response = await fetch(`${hosted.config.mcp?.url}/token`, { method: 'POST' });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { token: string; expiresAt: number; ttlMs: number };
    expect(body.ttlMs).toBeGreaterThan(0);
    return body.token;
  }

  it('advertises the hosted surfaces: token-gated MCP and the mounted bridge', async () => {
    const hosted = await startHosted();
    expect(hosted.config.mcp).toMatchObject({ enabled: true, tokenRequired: true, url: `http://127.0.0.1:${hosted.port}/mcp` });
    expect(hosted.config.bridge).toEqual({ enabled: true, path: '/bridge' });
    expect(hosted.config.relay.url).toBe(`ws://127.0.0.1:${hosted.port}/collab`);

    // Per-session tokens: refused without one, accepted with one, revocable.
    expect((await fetch(hosted.config.mcp!.url!, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) })).status).toBe(401);
    const token = await mint(hosted);
    const call = (body: unknown) =>
      fetch(hosted.config.mcp!.url!, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
    expect((await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })).status).toBe(200);
    expect((await fetch(`${hosted.config.mcp!.url}/token`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
    expect((await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).status).toBe(401);

    // The MCP status surface reports the state and the registry-derived count.
    const token2 = await mint(hosted);
    const mcpStatus = (await (
      await fetch(`${hosted.config.mcp!.url}/status`, { headers: { authorization: `Bearer ${token2}` } })
    ).json()) as { state: string; toolCount: number };
    expect(mcpStatus).toMatchObject({ state: 'hosted', toolCount: allTools.length });

    // The bridge is mounted on the same address (its routes exist; a bad token is
    // refused) and reports aggregate status only.
    const status = (await (await fetch(`http://127.0.0.1:${hosted.port}/bridge/status`)).json()) as Record<string, unknown>;
    expect(Object.keys(status).sort()).toEqual(['client', 'commands', 'connected', 'connections', 'revision']);
    expect((await fetch(`http://127.0.0.1:${hosted.port}/bridge/events?token=wrong`)).status).toBe(401);
    expect((await fetch(`http://127.0.0.1:${hosted.port}/bridge/result`, { method: 'POST', headers: { 'x-pigma-token': 'wrong' }, body: '{}' })).status).toBe(401);
  }, 45_000);

  it('serves a fully working MCP endpoint through the bridge, logging and storing nothing', async () => {
    const hosted = await startHosted();
    const token = await mint(hosted);
    const endpoint = hosted.config.mcp!.url!;

    // A live editor on the bridge: the hosted endpoint is "fully working" because
    // tool calls reach the user's document, not a server-side copy.
    const editor = new FakeBrowser(`http://127.0.0.1:${hosted.port}`, bridgeTokenOf(hosted), emptyFile('Hosted'));
    editors.push(editor);
    await waitForBridge(hosted);

    // A tool call whose arguments carry the marker, and whose result would carry
    // a document. `use_pigma` is the most payload-heavy tool there is.
    const result = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name: 'use_pigma',
          arguments: {
            code: `const text = figma.createText({ characters: '${MARKER}' }); text.name = '${DOCUMENT_MARKER}'; text.id;`,
          },
        },
      }),
    });
    expect(result.status).toBe(200);
    const body = (await result.json()) as { result?: { structuredContent?: { output: string } }; error?: unknown; isError?: boolean };
    // The caller gets its result (the server does see the call)…
    expect(body.error).toBeUndefined();
    expect(typeof body.result?.structuredContent?.output).toBe('string');

    // …but the marker appears in no log line, on either stream.
    const stdout = hosted.stdout();
    const stderr = hosted.stderr();
    expect(stdout).not.toContain(MARKER);
    expect(stderr).not.toContain(MARKER);
    expect(stdout).not.toContain(DOCUMENT_MARKER);
    expect(stderr).not.toContain(DOCUMENT_MARKER);
    // Nor the code the caller sent, nor the document it produced.
    expect(`${stdout}${stderr}`).not.toContain('figma.createText');

    // Nor in any file the server wrote.
    const files = await readdir(dataDir as string);
    expect(files).toEqual([]);

    // And the metrics surface is aggregate-only: counters and gauges, no payload.
    const health = await (await fetch(`http://127.0.0.1:${hosted.port}/health`)).text();
    const metrics = await (await fetch(`http://127.0.0.1:${hosted.port}/metrics`)).text();
    for (const text of [health, metrics]) {
      expect(text).not.toContain(MARKER);
      expect(text).not.toContain(DOCUMENT_MARKER);
    }
    expect(JSON.parse(health)).toMatchObject({ ok: true });
    expect(metrics).toContain('pigma_rooms');
  }, 45_000);

  it('does not log payloads on the error path either', async () => {
    const hosted = await startHosted();
    const token = await mint(hosted);
    const endpoint = hosted.config.mcp!.url!;
    const editor = new FakeBrowser(`http://127.0.0.1:${hosted.port}`, bridgeTokenOf(hosted), emptyFile('Hosted'));
    editors.push(editor);
    await waitForBridge(hosted);

    // A failing tool call whose *error* carries the marker: it travels back to the
    // caller through the plugin error path and must not be logged anywhere.
    const failed = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: { name: 'use_pigma', arguments: { code: `throw new Error('${MARKER}');` } },
      }),
    });
    expect(failed.status).toBe(200);
    const failedBody = (await failed.json()) as { result?: { isError?: boolean; content?: Array<{ text?: string }> } };
    // The error really did carry the marker to the caller…
    expect(failedBody.result?.isError).toBe(true);
    expect(JSON.stringify(failedBody)).toContain(MARKER);

    // A malformed body carrying the marker, and an unknown method.
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: `{"jsonrpc":"2.0","id":9,"method":"nope","params":{"marker":"${MARKER}"}}`,
    });
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: `{not json ${MARKER}`,
    });

    const combined = `${hosted.stdout()}${hosted.stderr()}`;
    expect(combined).not.toContain(MARKER);
    expect(await readdir(dataDir as string)).toEqual([]);
  }, 45_000);

  it('answers a malformed bridge result with 400 instead of throwing it into a log', async () => {
    const hosted = await startHosted();
    const editor = new FakeBrowser(`http://127.0.0.1:${hosted.port}`, bridgeTokenOf(hosted), emptyFile('Hosted'));
    editors.push(editor);
    await waitForBridge(hosted);

    // A body that is not JSON, carrying the marker: a parse error message would
    // quote it, so the bridge must answer 400 and log nothing.
    const response = await fetch(`http://127.0.0.1:${hosted.port}/bridge/result`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-pigma-token': bridgeTokenOf(hosted) },
      body: `{not json ${MARKER}`,
    });
    expect(response.status).toBe(400);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(`${hosted.stdout()}${hosted.stderr()}`).not.toContain(MARKER);
    expect(await readdir(dataDir as string)).toEqual([]);
  }, 45_000);

  it('keeps the room snapshot path separate: it stores documents only when a room publishes one', async () => {
    const hosted = await startHosted();
    const token = await mint(hosted);
    const endpoint = hosted.config.mcp!.url!;
    const editor = new FakeBrowser(`http://127.0.0.1:${hosted.port}`, bridgeTokenOf(hosted), emptyFile('Hosted'));
    editors.push(editor);
    await waitForBridge(hosted);

    // An MCP write must not touch the data dir…
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'use_pigma', arguments: { code: `figma.createText({ characters: '${MARKER}' });` } } }),
    });
    expect(await readdir(dataDir as string)).toEqual([]);

    // …while a room snapshot (a different, already TTL-cached path) is written
    // when a client publishes one, and that file holds no MCP payload.
    const client = await TestClient.connect(`${hosted.config.relay.url}?room=snap`);
    client.send({ t: 'hello', clientId: 'snap-a', nickname: 'Ada' });
    await client.next('welcome');
    client.send({ t: 'snapshot', file: { schema: 'pigma/1', name: 'Room doc' }, seq: 1 });
    await new Promise((resolve) => setTimeout(resolve, 200));
    client.close();

    const files = await readdir(dataDir as string);
    expect(files).toEqual(['snap.json']);
    const stored = await readFile(join(dataDir as string, files[0] as string), 'utf8');
    expect(stored).toContain('Room doc');
    expect(stored).not.toContain(MARKER);
    expect((await stat(join(dataDir as string, files[0] as string))).size).toBeGreaterThan(0);
  }, 45_000);
});
