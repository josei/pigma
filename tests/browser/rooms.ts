import { test as base, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

/**
 * Local collab relay for the ROOMS tests.
 *
 * The relay is shipped as `src/collab/server.ts` with `createCollabServer(...)`
 * but (as of writing) has no CLI entry. This fixture LOOKS FOR a package.json
 * script whose name mentions relay/collab/rooms and starts it on a free port;
 * when none exists every ROOMS test SKIPS with that reason instead of failing,
 * so the suite stays green until the CLI lands and then starts exercising.
 */
export interface RoomsRelay {
  /** ws:// origin the Rooms panel should use, e.g. ws://127.0.0.1:41234 */
  url: string;
}

/** package.json script keys that look like a collab relay, if any. */
export function findRelayScript(): string | null {
  try {
    const pkg = JSON.parse(readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const keys = Object.keys(pkg.scripts ?? {});
    return keys.find((k) => /relay|collab|rooms/i.test(k)) ?? null;
  } catch {
    return null;
  }
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

async function waitForPort(port: number, timeoutMs = 30000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const probe = createServer();
    const ok = await new Promise<boolean>((resolve) => {
      probe.once('error', () => resolve(false));
      probe.listen(port, '127.0.0.1', () => {
        const closed = once(probe, 'close');
        probe.close();
        void closed.then(() => resolve(true));
      });
    });
    if (!ok) return true; // something is already listening
    await delay(250);
  }
  return false;
}

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

export const test = base.extend<{ roomsRelay: RoomsRelay }>({
  roomsRelay: async ({}, use) => {
    const script = process.env.PIGMA_ROOMS_RELAY_SCRIPT ?? findRelayScript();
    if (!script) {
      test.skip(
        true,
        'no collab relay CLI yet: expected a package.json script matching /relay|collab|rooms/ ' +
          '(src/collab/server.ts has no entry point). Set PIGMA_ROOMS_RELAY_SCRIPT to override.',
      );
    }
    const port = await freePort();
    const child = spawn('npm', ['run', script!, '--', '--port', String(port)], {
      cwd: process.cwd(),
      stdio: 'ignore',
      detached: true,
      env: { ...process.env, PORT: String(port) },
    });
    try {
      const up = await waitForPort(port);
      expect(up, `relay script "${script}" never started listening on ${port}`).toBe(true);
      await use({ url: `ws://127.0.0.1:${port}` });
    } finally {
      await stopProcessTree(child);
    }
  },
});

export { expect };
