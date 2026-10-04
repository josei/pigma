import { vi, afterEach, describe, expect, it } from 'vitest';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnViteNode, waitForLine, type SpawnedProcess } from './fixtures/spawn';
import { figmaRestToPigmaFile } from '../../src/figma/convert/convert';
import { parseFigmaRestFile } from '../../src/figma/rest/parse';
import type { PigmaFile } from '../../src/model/types';

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

interface Host extends SpawnedProcess {
  process: ChildProcessWithoutNullStreams;
  mcpUrl: string;
  relayUrl: string;
  token: string;
}

const hosts: Host[] = [];

afterEach(async () => {
  // Kill the whole process group so no vite-node worker is left behind.
  for (const host of hosts.splice(0)) await host.kill();
});

/** Spawn the relay host and wait for its READY line. */
async function startHost(timeoutMs: number): Promise<Host> {
  const spawned = spawnViteNode('tests/mcp/fixtures/relay-host.ts', [], { RELAY_TIMEOUT_MS: String(timeoutMs) });
  const child = spawned.process as ChildProcessWithoutNullStreams;
  const match = await waitForLine(child, /READY (\S+) (\S+) (\S+)/);
  const host: Host = {
    ...spawned,
    process: child,
    mcpUrl: match[1] as string,
    relayUrl: match[2] as string,
    token: match[3] as string,
  };
  hosts.push(host);
  return host;
}

async function callTool(host: Host, name: string, args: Record<string, unknown>) {
  const response = await fetch(host.mcpUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const payload = (await response.json()) as { result?: { isError?: boolean; content: Array<{ text?: string }> } };
  return payload.result;
}

/** Connect to the relay but never answer commands (a hung/stalled editor). */
async function connectSilent(host: Host): Promise<{ abort: AbortController; waitConnected: () => Promise<void> }> {
  const abort = new AbortController();
  const response = await fetch(`${host.relayUrl}/bridge/events?token=${host.token}&client=silent`, { signal: abort.signal });
  const reader = response.body?.getReader();
  if (!reader) throw new Error('no SSE body');
  let buffer = '';
  const connected = new Promise<void>((resolve) => {
    void (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += new TextDecoder().decode(value);
        if (buffer.includes('event: hello')) resolve();
      }
    })().catch(() => undefined);
  });
  // Initial sync so reads work.
  await fetch(`${host.relayUrl}/bridge/result`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-pigma-token': host.token },
    body: JSON.stringify({ id: 0, ok: true, sync: { file: initialFile(), selection: [], revision: 0 } }),
  });
  return { abort, waitConnected: () => connected };
}

describe('relay crash resistance (spawned process)', () => {
  it('times out an unacknowledged mutation as a tool error and keeps the process alive', async () => {
    const host = await startHost(300);
    const silent = await connectSilent(host);
    await silent.waitConnected();

    const edit = await callTool(host, 'use_pigma', { code: "figma.createFrame({ name: 'Never Acked' }); 'x';" });
    expect(edit?.isError).toBe(true);
    expect(edit?.content[0]?.text).toMatch(/timed out/);

    // The process survived the timeout (the old crash was an unhandled rejection).
    expect(host.process.exitCode).toBeNull();

    // A new editor can connect and reads work again.
    silent.abort.abort();
    const second = await connectSilent(host);
    await second.waitConnected();
    const metadata = await callTool(host, 'get_metadata', { nodeId: '1:2' });
    expect(metadata?.isError).toBeFalsy();
    expect(metadata?.content[0]?.text).toContain('id="1:2"');
  }, 90_000);

  it('fails an in-flight mutation when the editor disconnects, without crashing', async () => {
    const host = await startHost(10_000);
    const silent = await connectSilent(host);
    await silent.waitConnected();

    const pending = callTool(host, 'use_pigma', { code: "figma.createFrame({ name: 'Interrupted' }); 'x';" });
    // Give the command time to reach the editor, then drop the connection.
    await new Promise((resolve) => setTimeout(resolve, 100));
    silent.abort.abort();

    const edit = await pending;
    expect(edit?.isError).toBe(true);
    expect(edit?.content[0]?.text).toMatch(/No editor is connected/);
    expect(host.process.exitCode).toBeNull();
  }, 90_000);
});
