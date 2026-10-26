import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, copyFileSync } from 'node:fs';
import { connect } from 'node:net';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The desktop sidecar's servers : the build script bundles the relay and the MCP
 * server, and each bundle must start from its own directory with no repository around it.
 */
const ROOT = process.cwd();
const OUT = join(ROOT, 'dist-servers');

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

describe('desktop server bundles', () => {
  it('builds the relay and MCP server into dist-servers/', () => {
    execFileSync(process.execPath, [join(ROOT, 'scripts/build-servers.mjs')], { cwd: ROOT, stdio: 'pipe' });
    expect(existsSync(join(OUT, 'relay.mjs'))).toBe(true);
    expect(existsSync(join(OUT, 'mcp.mjs'))).toBe(true);
    expect(existsSync(join(OUT, 'node_modules', '@resvg'))).toBe(true);
  }, 120_000);

  it('the relay bundle starts and listens without the repository around it', async () => {
    const port = await freePort();
    const child = spawn(process.execPath, ['relay.mjs', '--port', String(port), '--host', '127.0.0.1', '--no-data'], {
      cwd: OUT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    try {
      const listening = await new Promise<string>((resolve, reject) => {
        let output = '';
        const timer = setTimeout(() => reject(new Error(`no listening line; got: ${output}`)), 30_000);
        child.stdout.on('data', (chunk: Buffer) => {
          output += chunk.toString();
          if (output.includes('listening')) {
            clearTimeout(timer);
            resolve(output);
          }
        });
        child.once('exit', (code) => reject(new Error(`exited ${code} before listening: ${output}`)));
      });
      expect(listening).toContain(`127.0.0.1:${port}`);
    } finally {
      child.kill('SIGTERM');
    }
  }, 60_000);

  it('the MCP bundle starts and prints its usage', () => {
    // Usage goes to stderr (and the exit is non-zero), so both streams are read. VITEST is removed
    // from the child's environment: the CLI stays silent under a test runner.
    const { VITEST: _unused, ...env } = process.env;
    const result = spawnSync(process.execPath, ['mcp.mjs', '--help'], { cwd: OUT, encoding: 'utf8', env });
    expect(result.stdout + result.stderr).toContain('Usage');
  }, 30_000);

  it('the supervisor runs both servers, and stops them when its standard input closes', async () => {
    copyFileSync(join(ROOT, 'scripts/sidecar-supervisor.mjs'), join(OUT, 'supervisor.mjs'));
    const relayPort = await freePort();
    const mcpPort = await freePort();
    const child = spawn(
      process.execPath,
      ['supervisor.mjs', '--relay-port', String(relayPort), '--mcp-port', String(mcpPort)],
      { cwd: OUT, stdio: ['pipe', 'ignore', 'ignore'], env: withoutVitest() },
    );
    try {
      await waitForPort(relayPort);
      await waitForPort(mcpPort);
      // The parent closing the pipe is the signal to stop: both servers must go.
      child.stdin.end();
      await waitForClosed(relayPort);
      await waitForClosed(mcpPort);
    } finally {
      child.kill('SIGTERM');
    }
  }, 90_000);
});

function withoutVitest(): NodeJS.ProcessEnv {
  const { VITEST: _unused, ...env } = process.env;
  return env;
}

function isListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

async function waitForPort(port: number, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isListening(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`port ${port} never listened`);
}

async function waitForClosed(port: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isListening(port))) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`port ${port} is still open after the pipe closed`);
}
