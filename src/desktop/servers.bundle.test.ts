import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The desktop sidecar's servers (ROADMAP M17): the build script bundles the relay and the MCP
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
});
