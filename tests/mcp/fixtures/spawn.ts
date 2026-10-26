/**
 * Test helper: spawn a vite-node script as its own process group and kill the
 * whole tree on teardown.
 *
 * `npx vite-node …` leaves the real worker orphaned when only the npx wrapper is
 * signalled, and vitest reuses the module graph across runs, so leaked servers
 * accumulate and exhaust resources. Spawning `node <vite-node entry>` directly,
 * detached (its own process group), lets teardown signal the entire group.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const VITE_NODE_ENTRY = fileURLToPath(new URL('../../../node_modules/vite-node/vite-node.mjs', import.meta.url));

export interface SpawnedProcess {
  process: ChildProcess;
  kill(): Promise<void>;
}

/** Spawn `vite-node <script> <args…>` in its own process group. */
export function spawnViteNode(
  script: string,
  args: string[] = [],
  env: Record<string, string> = {},
  options: { stdin?: boolean } = {},
): SpawnedProcess {
  const child = spawn(process.execPath, [VITE_NODE_ENTRY, script, ...args], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, ...env },
    detached: true,
    // A stdio MCP session needs to write to the child, so stdin is a pipe there.
    stdio: [options.stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
  });
  return { process: child, kill: () => killProcessTree(child) };
}

/** SIGTERM the child's process group, then SIGKILL if it does not exit in time. */
export async function killProcessTree(child: ChildProcess, graceMs = 2000): Promise<void> {
  const pid = child.pid;
  if (!pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    // Group already gone (or never created): fall back to the direct child.
    try {
      child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
  await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, graceMs))]);
  if (child.exitCode === null && child.signalCode === null) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }
    await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, graceMs))]);
  }
}

/** Read one line from a child's stdout matching `pattern`. */
export function waitForLine(child: ChildProcess, pattern: RegExp, timeoutMs = 60_000): Promise<RegExpExecArray> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for ${pattern} (output: ${buffer.slice(0, 400)})`));
    }, timeoutMs);
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString('utf8');
      const match = pattern.exec(buffer);
      if (match) {
        cleanup();
        resolve(match);
      }
    };
    const onExit = (code: number | null): void => {
      cleanup();
      reject(new Error(`process exited early (${code}): ${buffer.slice(0, 400)}`));
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      child.stdout?.off('data', onData);
      child.off('exit', onExit);
    };
    child.stdout?.on('data', onData);
    child.on('exit', onExit);
  });
}
