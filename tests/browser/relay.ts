import { test as base, expect, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

/**
 * Managed relay for the MCP bridge tests.
 *
 * Each worker starts its own `src/mcp/bin.ts --bridge` process on free ports
 * with a random token, and kills it on teardown, so `npm run test:browser`
 * exercises the connection tests without external setup. Unique ports keep
 * concurrent workers from colliding.
 */
export interface RelayInfo {
  /** Bridge relay base URL (SSE + /bridge/status). */
  url: string;
  /** MCP HTTP endpoint (JSON-RPC). */
  mcpUrl: string;
  /** Per-run relay token. */
  token: string;
}

async function freePort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const address = probe.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const closed = once(probe, 'close');
  probe.close();
  await closed;
  return port;
}

async function waitForRelay(url: string, token: string, timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/bridge/status?token=${encodeURIComponent(token)}`);
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    await delay(200);
  }
  throw new Error(`relay at ${url} did not become ready within ${timeoutMs}ms`);
}

/** True while the relay still serves; false once its process has died. */
export async function relayIsAlive(relay: RelayInfo): Promise<boolean> {
  try {
    const response = await fetch(`${relay.url}/bridge/status?token=${encodeURIComponent(relay.token)}`);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Kill the relay and everything it spawned.
 *
 * The relay is started detached so it leads its own process group; signalling
 * the group reaps the vite-node child as well. A plain `child.kill()` only
 * signals the direct child, which orphaned the grandchild and let relays
 * accumulate across runs until the suite failed on resource exhaustion.
 */
async function stopProcessTree(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (!pid) return;
  const signalTree = (signal: NodeJS.Signals) => {
    try {
      process.kill(-pid, signal);
    } catch {
      try {
        child.kill(signal);
      } catch {
        // already gone
      }
    }
  };
  const exited = once(child, 'exit').then(() => undefined);
  signalTree('SIGTERM');
  await Promise.race([exited, delay(3000)]);
  signalTree('SIGKILL');
}

/** POST a JSON-RPC message to the MCP HTTP endpoint. */
export async function mcpCall(relay: RelayInfo, method: string, params: unknown) {
  const response = await fetch(relay.mcpUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now() % 100000, method, params }),
  });
  return response.json();
}

/**
 * Open the editor and attach it to the relay through the real bridge panel.
 *
 * The panel reports "connected" as soon as its SSE stream opens, but the relay
 * only registers the client a moment later, and a tool call in that window is
 * rejected with "No editor is connected". Wait for the relay itself.
 */
export async function connectEditor(page: Page, relay: RelayInfo): Promise<void> {
  // Only navigate when the app is not already loaded. Navigating would reload
  // the document, discarding any local edits made before connecting.
  if ((await page.locator('.app').count()) === 0) {
    await page.goto('/');
    await page.waitForSelector('.app');
  }
  await page.locator('.rail__button[aria-label="Tools"]').click();
  await page.locator('input[aria-label="Relay URL"]').fill(relay.url);
  await page.locator('input[aria-label="Relay token"]').fill(relay.token);
  await page.locator('button', { hasText: 'Connect MCP' }).click();
  await expect(page.locator('[data-testid="mcp-bridge-status"]')).toHaveText(/connected/, {
    timeout: 15000,
  });

  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${relay.url}/bridge/status?token=${encodeURIComponent(relay.token)}`);
      const body = (await response.json()) as { connected?: boolean; client?: string | null };
      // Wait for OUR editor to be the active client, not merely for *an*
      // editor: the relay mirrors one active editor at a time.
      if (body.connected && body.client === 'pigma-editor') return;
    } catch {
      // relay not answering yet
    }
    await delay(150);
  }
  throw new Error('relay never registered the editor as connected');
}

export const test = base.extend<{ relay: RelayInfo }, {}>({
  relay: [
    async ({}, use) => {
      const relayPort = await freePort();
      const mcpPort = await freePort();
      const token = `qa-${Math.random().toString(36).slice(2, 12)}`;

      // Spawn the local binary directly: going through `npx` adds a wrapper
      // process that outlives the relay. Detached puts the relay in its own
      // process group so stopProcessTree can reap the whole tree.
      const child: ChildProcess = spawn(
        path.resolve(process.cwd(), 'node_modules/.bin/vite-node'),
        [
          'src/mcp/bin.ts',
          '--bridge',
          '--relay-token',
          token,
          '--relay-port',
          String(relayPort),
          '--port',
          String(mcpPort),
        ],
        { cwd: process.cwd(), stdio: 'ignore', detached: true },
      );

      const relay: RelayInfo = {
        url: `http://127.0.0.1:${relayPort}`,
        mcpUrl: `http://127.0.0.1:${mcpPort}`,
        token,
      };

      await waitForRelay(relay.url, token);
      try {
        await use(relay);
      } finally {
        await stopProcessTree(child);
      }
    },
    // The setup spawns a `vite-node` relay and waits for it to answer. That is a
    // PROCESS START, not the test's assertion - and a test-scoped fixture's setup
    // otherwise spends the TEST's 30s budget, so a slow start under load fails the
    // test for a reason it does not own. Seen at round 115: `Test timeout of
    // 30000ms exceeded while setting up "relay"` on B18a, while run 2 was clean.
    { scope: 'test', timeout: 90_000 },
  ],
});

export { expect };
