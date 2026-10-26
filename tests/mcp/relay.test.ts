import { vi, afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { figmaRestToPigmaFile } from '../../src/figma/convert/convert';
import { parseFigmaRestFile } from '../../src/figma/rest/parse';
import type { PigmaFile, SceneNode } from '../../src/model/types';
import { findNode } from '../../src/model/tree';
import { createMcpServer } from '../../src/mcp/protocol';
import { nodeRasterizer } from '../../src/mcp/raster.node';
import { startRelayServer, type RelayHandle } from '../../src/mcp/relay';
import { startHttpServer, type HttpServerHandle } from '../../src/mcp/transports/node';
import { FakeBrowser } from './fakeEditor';

/**
 * These tests drive real sockets, real HTTP and spawned processes. Their subject
 * is protocol behaviour, not latency, so they get a generous per-file bound: a
 * busy box must not turn a slow-but-correct round trip into a failure. It is
 * still a *bound* — a genuine hang fails here, with vitest naming the timeout.
 */
vi.setConfig({ testTimeout: 60_000 });

const json = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../figma/fixtures/${name}`, import.meta.url)), 'utf8'));

function initialFile(): PigmaFile {
  return figmaRestToPigmaFile(parseFigmaRestFile(json('rest-file.json')), { now: () => 1 }).file;
}

/** Add a named rectangle to the first page (stands in for a local draw). */
function addRect(file: PigmaFile, id: string, name: string): PigmaFile {
  const page = file.document.children[0];
  if (!page) return file;
  const node: SceneNode = {
    id,
    name,
    type: 'RECTANGLE',
    visible: true,
    locked: false,
    opacity: 1,
    transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    width: 10,
    height: 10,
    fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }],
    strokes: [],
  };
  return { ...file, document: { ...file.document, children: [{ ...page, children: [...page.children, node] }, ...file.document.children.slice(1)] } };
}

const relays: RelayHandle[] = [];
const servers: HttpServerHandle[] = [];
const browsers: FakeBrowser[] = [];

afterEach(async () => {
  for (const browser of browsers.splice(0)) browser.close();
  await Promise.all(servers.splice(0).map((server) => server.close().catch(() => undefined)));
  await Promise.all(relays.splice(0).map((relay) => relay.close().catch(() => undefined)));
});

/**
 * Generous bridge command budget for the shared fixture: the subject of these
 * tests is serialization and round trips, not latency, and a busy box must not
 * turn a slow-but-correct command into a "timed out" failure. A test that means
 * to assert the timeout uses its own short value (see relay-crash.test.ts).
 */
const BRIDGE_COMMAND_TIMEOUT_MS = 60_000;

async function setup(): Promise<{ relay: RelayHandle; server: HttpServerHandle; browser: FakeBrowser; client: Client }> {
  const relay = await startRelayServer({ token: 'test-token', commandTimeoutMs: BRIDGE_COMMAND_TIMEOUT_MS });
  relays.push(relay);
  const server = await startHttpServer(createMcpServer({ session: relay.session, rasterizer: nodeRasterizer }));
  servers.push(server);
  const browser = new FakeBrowser(relay.url, relay.token, initialFile());
  browsers.push(browser);
  await browser.waitUntil(() => relay.status().connected);
  const client = new Client({ name: 'external-harness-unknown', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(server.url)));
  return { relay, server, browser, client };
}

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  return (result.content as Array<{ text?: string }>)[0]?.text ?? '';
}

describe('hosted bridge credentials', () => {
  it('accepts the operator token and a live session token, and nothing else', async () => {
    const { TokenStore } = await import('../../src/mcp/tokens');
    const tokens = new TokenStore({ ttlMs: 60_000 });
    const session = tokens.mint(null);
    const relay = await startRelayServer({ token: 'operator-secret', sessionTokens: tokens });
    relays.push(relay);

    const attempt = async (token: string): Promise<number> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      try {
        const response = await fetch(`${relay.url}/bridge/events?token=${encodeURIComponent(token)}&client=probe`, {
          signal: controller.signal,
        });
        // The event stream stays open when accepted: read the status, then drop it.
        controller.abort();
        return response.status;
      } catch {
        return 0;
      } finally {
        clearTimeout(timer);
      }
    };

    // The operator's secret keeps working, and a minted session token does too —
    // that is what lets a hosted user connect the bridge with no download.
    expect(await attempt('operator-secret')).toBe(200);
    expect(await attempt(session.token)).toBe(200);
    // Anything else is refused, including a revoked or expired session.
    expect(await attempt('not-a-token')).toBe(401);
    tokens.revoke(session.token);
    expect(await attempt(session.token)).toBe(401);
  });

  it('refuses a session token when the deployment minted none', async () => {
    const relay = await startRelayServer({ token: 'operator-secret' });
    relays.push(relay);
    const response = await fetch(`${relay.url}/bridge/events?token=whatever&client=probe`).catch(() => null);
    expect(response?.status).toBe(401);
  });
});

describe('browser relay bridge', () => {
  it('sees local edits and selection made after connect', async () => {
    const { relay, browser, client } = await setup();

    await browser.localEdit((file) => addRect(file, 'local:1', 'Locally Drawn'), ['1:3']);
    await browser.waitUntil(() => relay.status().revision >= 1);

    const metadata = await client.callTool({ name: 'get_metadata', arguments: { nodeId: 'local:1' } });
    expect(textOf(metadata)).toContain('Locally Drawn');

    // Selection follows into design context (no nodeId supplied).
    const context = await client.callTool({ name: 'get_design_context', arguments: {} });
    const nodes = (context.structuredContent as { nodes: Array<{ id: string }> }).nodes;
    expect(nodes[0]?.id).toBe('1:3');

    await client.close();
  });

  it('applies remote writes only after the editor ACKs, and the change is visible immediately', async () => {
    const { browser, client } = await setup();

    const edit = await client.callTool({
      name: 'use_pigma',
      arguments: { code: "const f = figma.createFrame({ name: 'Remote Frame', width: 50, height: 50 }); f.id;" },
    });
    const nodeId = (edit.structuredContent as { output?: string } | undefined)?.output;
    expect(nodeId).toBeTruthy();

    // ACK was awaited, so the editor already has it and the relay mirror agrees.
    expect(findNode(browser.file?.document ?? initialFile().document, nodeId ?? '')?.name).toBe('Remote Frame');
    const metadata = await client.callTool({ name: 'get_metadata', arguments: { nodeId: nodeId ?? '' } });
    expect(textOf(metadata)).toContain('Remote Frame');

    await client.close();
  });

  it('rejects a write computed from a stale revision instead of losing the local edit', async () => {
    const { relay, browser } = await setup();

    // The caller takes a snapshot (revision 0), then a local edit lands
    // (revision 1) before the write — exactly how the write tools read.
    const snapshot = await relay.session.getSnapshot?.();
    expect(snapshot?.file).toBeTruthy();
    const readRevision = snapshot?.revision ?? 0;
    await browser.localEdit((file) => addRect(file, 'local:2', 'Local Wins'));
    await browser.waitUntil(() => relay.status().revision >= 1);

    const staleWrite = addRect(snapshot?.file as PigmaFile, 'remote:1', 'Remote Loser');
    await expect(relay.session.setFile(staleWrite, { expectedRevision: readRevision })).rejects.toThrow(/stale revision/);

    // The local edit survived.
    expect(findNode(browser.file?.document ?? initialFile().document, 'local:2')).not.toBeNull();
    expect(findNode(browser.file?.document ?? initialFile().document, 'remote:1')).toBeNull();
  });

  it('preserves interleaved local and remote edits', async () => {
    const { relay, browser, client } = await setup();

    await browser.localEdit((file) => addRect(file, 'local:3', 'Local A'));
    await browser.waitUntil(() => relay.status().revision >= 1);

    // Remote edit is based on a fresh read, so it carries the local node.
    const edit = await client.callTool({
      name: 'use_pigma',
      arguments: { code: "const f = figma.createFrame({ name: 'Remote B', width: 20, height: 20 }); f.id;" },
    });
    const remoteId = (edit.structuredContent as { output?: string } | undefined)?.output;

    await browser.localEdit((file) => addRect(file, 'local:4', 'Local C'));

    expect(textOf(await client.callTool({ name: 'get_metadata', arguments: { nodeId: 'local:3' } }))).toContain('Local A');
    expect(textOf(await client.callTool({ name: 'get_metadata', arguments: { nodeId: remoteId ?? '' } }))).toContain('Remote B');
    expect(textOf(await client.callTool({ name: 'get_metadata', arguments: { nodeId: 'local:4' } }))).toContain('Local C');
    expect(findNode(browser.file?.document ?? initialFile().document, remoteId ?? '')).not.toBeNull();

    await client.close();
  });

  it('reports an error for mutations when the editor is disconnected', async () => {
    const { relay, browser, client } = await setup();
    browser.close();
    await browser.waitUntil(() => !relay.status().connected);

    const edit = await client.callTool({
      name: 'use_pigma',
      arguments: { code: "figma.createFrame({ name: 'Nope' }); 'x';" },
    });
    expect(edit.isError).toBe(true);
    expect(textOf(edit)).toMatch(/No editor is connected/);

    await expect(relay.session.setFile(initialFile())).rejects.toThrow(/No editor is connected/);
    await client.close();
  });

  it('mirrors only the active editor when two windows are connected', async () => {
    const { relay, browser } = await setup();
    const second = new FakeBrowser(relay.url, relay.token, initialFile(), 'second-window');
    browsers.push(second);
    await second.waitUntil(() => relay.status().connected && relay.status().connections === 2);

    // The second (most recent) window is active: its selection is mirrored.
    await second.localEdit((file) => file, ['1:3']);
    await second.waitUntil(() => relay.session.getSelection().includes('1:3'));

    // The older window pushes an empty selection; it must not clobber the mirror.
    await browser.localEdit((file) => file, []);
    await browser.waitUntil(() => relay.status().revision >= 1);
    await second.waitUntil(() => relay.session.getSelection().includes('1:3'));
    expect(relay.session.getSelection()).toEqual(['1:3']);
  });

  it('refreshes the mirror from the promoted editor after the active one disconnects', async () => {
    const { relay, browser } = await setup();
    // Give the first window its own document state before a second connects.
    await browser.localEdit((file) => addRect(file, 'first:1', 'First Window'), ['1:3']);
    await browser.waitUntil(() => relay.status().revision >= 1);

    const second = new FakeBrowser(relay.url, relay.token, initialFile(), 'second-window');
    browsers.push(second);
    await second.waitUntil(() => relay.status().connections === 2);
    await second.localEdit((file) => addRect(file, 'second:1', 'Second Window'));
    await second.waitUntil(() => {
      const file = relay.session.getFile();
      return !!file && findNode(file.document, 'second:1') !== null;
    });

    // The active window goes away; the other is promoted and the mirror is
    // refreshed from it (its pushes were ignored while it was not active).
    second.close();
    await browser.waitUntil(() => {
      const file = relay.session.getFile();
      return !!file && findNode(file.document, 'first:1') !== null && findNode(file.document, 'second:1') === null;
    });
    expect(relay.session.getSelection()).toEqual(['1:3']);
  });

  it('a reconnecting window does not steal the active editor', async () => {
    const { relay, browser } = await setup();
    // A second window connects and becomes active with its own selection.
    const second = new FakeBrowser(relay.url, relay.token, initialFile(), 'win-b');
    browsers.push(second);
    await second.waitUntil(() => relay.status().connections === 2 && relay.status().client === 'fake-browser');
    await second.localEdit((file) => file, ['1:3']);
    await second.waitUntil(() => relay.session.getSelection().includes('1:3'));

    // The first window drops and its EventSource retries with the same id.
    browser.close();
    await browser.waitUntil(() => relay.status().connections === 1);
    const resumed = new FakeBrowser(relay.url, relay.token, initialFile(), browser.id);
    browsers.push(resumed);
    await resumed.waitUntil(() => relay.status().connections === 2);

    // It resumed; it did not take over, so the active selection is untouched.
    expect(relay.session.getSelection()).toEqual(['1:3']);
    const file = relay.session.getFile();
    expect(file).not.toBeNull();
  });

  it('resolves a caller-supplied page id through the bridge', async () => {
    const { browser, client } = await setup();
    const pageId = browser.file?.document.children[0]?.id as string;
    expect(pageId).toBeTruthy();
    const metadata = await client.callTool({ name: 'get_metadata', arguments: { nodeId: pageId } });
    const text = textOf(metadata);
    expect(text).toContain('id="1:2"');
    expect(text).toContain('name="Hero"');
    expect((metadata.structuredContent as { pages?: unknown } | undefined)?.pages).toBeUndefined();
    await client.close();
  });

  it('resets revision tracking when the editor reconnects', async () => {
    const relay = await startRelayServer({ token: 'test-token' });
    relays.push(relay);
    const server = await startHttpServer(createMcpServer({ session: relay.session, rasterizer: nodeRasterizer }));
    servers.push(server);

    const first = new FakeBrowser(relay.url, relay.token, initialFile());
    browsers.push(first);
    await first.waitUntil(() => relay.status().connected);
    await first.localEdit((file) => addRect(file, 'a:1', 'First'));
    await first.waitUntil(() => relay.status().revision >= 1);
    first.close();
    await first.waitUntil(() => !relay.status().connected);

    // A reloaded editor restarts its revision counter at 0.
    const second = new FakeBrowser(relay.url, relay.token, addRect(initialFile(), 'b:1', 'Second'));
    browsers.push(second);
    await second.waitUntil(() => relay.status().connected);
    await second.waitUntil(() => relay.status().revision === 0);
    // The revision resets BEFORE the reconnecting editor's file is re-established,
    // so waiting on the revision alone leaves a window where the session has no
    // file yet. That window is the flake (seen at rounds 97, 101, 110, 111 and
    // reproduced here): wait for the file the assertion is about.
    await second.waitUntil(() => relay.session.getFile() !== null);

    const file = relay.session.getFile();
    expect(file).not.toBeNull();
    expect(findNode((file as PigmaFile).document, 'b:1')).not.toBeNull();

    // Writes are accepted against the reset revision.
    await relay.session.setFile(addRect(file as PigmaFile, 'b:2', 'Written'));
    expect(findNode(second.file?.document ?? initialFile().document, 'b:2')).not.toBeNull();
  });

  it('serializes concurrent writers without losing updates', async () => {
    const { server, browser, client } = await setup();
    const second = new Client({ name: 'second-external-harness', version: '1.0.0' });
    await second.connect(new StreamableHTTPClientTransport(new URL(server.url)));

    const create = (name: string) => ({ name: 'use_pigma', arguments: { code: `figma.createFrame({ name: '${name}', width: 10, height: 10 }); 'x';` } });
    const [a, b] = await Promise.all([client.callTool(create('Concurrent A')), second.callTool(create('Concurrent B'))]);
    const results = [a, b];

    // No lost updates: every write reported as successful is present, and every
    // failure is an explicit stale-revision rejection (never a silent clobber).
    const succeeded = results.filter((result) => !result.isError);
    const failed = results.filter((result) => result.isError);
    expect(succeeded.length).toBeGreaterThanOrEqual(1);
    for (const result of failed) expect(textOf(result)).toMatch(/stale revision/);

    const doc = browser.file?.document ?? initialFile().document;
    for (const result of succeeded) {
      const created = (result.structuredContent as { results?: Array<{ nodeId?: string }> } | undefined)?.results?.[0]?.nodeId;
      if (created) expect(findNode(doc, created)).not.toBeNull();
    }

    // A retry after re-reading succeeds.
    const retry = await client.callTool(create('Concurrent Retry'));
    expect(retry.isError).toBeFalsy();
    await second.close();
    await client.close();
  });

  it('rejects a wrong token and a foreign origin', async () => {
    const relay = await startRelayServer({ token: 'right-token' });
    relays.push(relay);

    const badToken = await fetch(`${relay.url}/bridge/events?token=wrong`);
    expect(badToken.status).toBe(401);

    const badOrigin = await fetch(`${relay.url}/bridge/status`, { headers: { origin: 'https://evil.example' } });
    expect(badOrigin.status).toBe(403);

    const ok = await fetch(`${relay.url}/bridge/status`);
    expect(ok.status).toBe(200);
  });
});
