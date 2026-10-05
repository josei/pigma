/**
 * The stdio transport, end-to-end and without HTTP.
 *
 * `docs/ROADMAP.md` says "stdio stays an optional extra transport in the same
 * binary". This proves it: the CLI is spawned in stdio mode, and a hand-written
 * line client sends `initialize`, `tools/list` and real `tools/call` requests
 * over stdin, reading newline-delimited replies from stdout. No HTTP is
 * involved — the child is never given `--http` and never binds a port.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import { allTools } from '../../src/mcp/tools/index';
import { spawnViteNode, type SpawnedProcess } from './fixtures/spawn';

vi.setConfig({ testTimeout: 60_000 });

interface JsonRpcResponse {
  id?: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

/** A hand-written newline-delimited JSON-RPC client over the child's stdio. */
class StdioClient {
  private buffer = '';
  private readonly pending = new Map<number, { resolve: (value: JsonRpcResponse) => void; reject: (error: Error) => void }>();
  private exited: { code: number | null; signal: string | null } | null = null;
  readonly stderr: string[] = [];

  constructor(private readonly child: ChildProcess) {
    child.stdout?.on('data', (chunk: Buffer) => this.onData(chunk.toString('utf8')));
    child.stderr?.on('data', (chunk: Buffer) => this.stderr.push(chunk.toString('utf8')));
    child.once('exit', (code, signal) => {
      this.exited = { code, signal };
      for (const [, entry] of this.pending) entry.reject(new Error(`CLI exited (code ${code}) before answering; stderr: ${this.stderr.join('')}`));
      this.pending.clear();
    });
  }

  private onData(text: string): void {
    this.buffer += text;
    for (;;) {
      const newline = this.buffer.indexOf('\n');
      if (newline === -1) return;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line === '') continue;
      const message = JSON.parse(line) as JsonRpcResponse;
      if (message.id === undefined) continue;
      const entry = this.pending.get(message.id);
      if (entry) {
        this.pending.delete(message.id);
        entry.resolve(message);
      }
    }
  }

  /** Send a request and wait for its reply. */
  request(id: number, method: string, params?: unknown, timeoutMs = 30_000): Promise<JsonRpcResponse> {
    const payload = JSON.stringify(params === undefined ? { jsonrpc: '2.0', id, method } : { jsonrpc: '2.0', id, method, params });
    return new Promise<JsonRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`no reply to ${method} within ${timeoutMs}ms; stdout so far: ${this.buffer.slice(0, 200)}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.child.stdin?.write(`${payload}\n`);
    });
  }

  /** A notification: no reply is expected. */
  notify(method: string): void {
    this.child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
  }

  get hasExited(): boolean {
    return this.exited !== null;
  }

  waitForExit(timeoutMs = 15_000): Promise<{ code: number | null; signal: string | null }> {
    if (this.exited) return Promise.resolve(this.exited);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the CLI did not exit after stdin closed')), timeoutMs);
      this.child.once('exit', (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal });
      });
    });
  }
}

let spawned: SpawnedProcess | null = null;

afterEach(async () => {
  await spawned?.kill();
  spawned = null;
});

describe('the stdio transport, in the same binary', () => {
  it('serves the same registry and runs tools with no HTTP involved', async () => {
    // The same CLI `npm run mcp` starts — no --http, so it speaks stdio.
    // `VITEST` is cleared because the entry point deliberately does nothing when
    // a test runner is detected; a spawned session must behave like any process.
    spawned = spawnViteNode('src/mcp/bin.ts', [], { VITEST: '' }, { stdin: true });
    const child = spawned.process;
    const client = new StdioClient(child);

    // 1. initialize, from a harness name the server has never seen.
    const hello = await client.request(1, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'stdio-hand-written-harness', version: '0.0.1' },
    });
    expect(hello.error).toBeUndefined();
    expect((hello.result?.serverInfo as { name?: string } | undefined)?.name).toBe('pigma');

    // 2. initialized notification, then the catalog.
    client.notify('notifications/initialized');
    const listed = await client.request(2, 'tools/list');
    const names = ((listed.result?.tools ?? []) as Array<{ name: string }>).map((tool) => tool.name).sort();
    expect(names).toEqual(allTools.map((tool) => tool.definition.name).sort());
    expect(names).toHaveLength(allTools.length);

    // 3. A real write over stdio: create a document, then read it back.
    const created = await client.request(3, 'tools/call', { name: 'create_new_file', arguments: { name: 'Stdio', editorType: 'design' } });
    expect(created.error).toBeUndefined();
    const createdResult = created.result as { isError?: boolean; structuredContent?: Record<string, unknown> } | undefined;
    expect(createdResult?.isError).toBeFalsy();
    expect(createdResult?.structuredContent).toBeTruthy();

    // `get_metadata` with no node id answers with the page list (its documented
    // behaviour), which proves the new document is open and readable.
    const metadata = await client.request(4, 'tools/call', { name: 'get_metadata', arguments: {} });
    const metadataResult = metadata.result as { isError?: boolean; content?: Array<{ text?: string }> } | undefined;
    expect(metadataResult?.isError).toBeFalsy();
    expect(metadataResult?.content?.[0]?.text ?? '').toContain('Page 1');

    // 4. And the capability path answers explicitly over stdio too.
    const whoami = await client.request(5, 'tools/call', { name: 'whoami', arguments: {} });
    const whoamiResult = whoami.result as { isError?: boolean; structuredContent?: { supported?: boolean } } | undefined;
    expect(whoamiResult?.isError).toBe(true);
    expect(whoamiResult?.structuredContent?.supported).toBe(false);

    // 5. No HTTP was involved: the CLI never announced a listener.
    const output = `${client.stderr.join('')}`;
    expect(output).toContain('ready on stdio');
    expect(output).not.toContain('listening on http');

    // 6. Closing stdin ends the session cleanly.
    child.stdin?.end();
    expect(await client.waitForExit()).toEqual({ code: 0, signal: null });
  });
});
