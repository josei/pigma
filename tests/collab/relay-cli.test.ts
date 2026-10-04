/**
 * The relay CLI: flags, the printed URL, clean SIGTERM, and no orphaned
 * children.
 *
 * The integration test spawns the real entry point the way the npm script does —
 * from the local `vite-node` binary, never through `npx` — and asserts the child
 * exits 0 on SIGTERM with its port released, which is what a browser test needs
 * in order to spawn and stop a relay per run.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { parseRelayArgs, relayBanner, limitsFromEnv, RELAY_USAGE } from '../../server/args';
import { DEFAULT_LIMITS } from '../../src/collab/limits';
import { TestClient } from './harness';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const viteNode = `${repoRoot}node_modules/.bin/vite-node`;

describe('relay flags', () => {
  it('defaults to the deployment shape and lets flags win over the environment', () => {
    expect(parseRelayArgs([], {})).toMatchObject({ port: 8080, host: '0.0.0.0', dataDir: 'data', staticDir: 'dist', help: false });
    expect(parseRelayArgs([], { PORT: '9000', HOST: '127.0.0.1', DATA_DIR: '/tmp/d', STATIC_DIR: '/tmp/s' })).toMatchObject({
      port: 9000,
      host: '127.0.0.1',
      dataDir: '/tmp/d',
      staticDir: '/tmp/s',
    });
    expect(parseRelayArgs(['--port', '8788', '--host', '127.0.0.1'], { PORT: '9000' })).toMatchObject({
      port: 8788,
      host: '127.0.0.1',
    });
    // `--flag=value` works too, and 0 means "pick a free port".
    expect(parseRelayArgs(['--port=0'], {})).toMatchObject({ port: 0 });
  });

  it('supports a relay-only, in-memory run and an optional token', () => {
    const options = parseRelayArgs(['--no-data', '--no-static', '--token', 'sekret'], {});
    expect(options.dataDir).toBeUndefined();
    expect(options.staticDir).toBeUndefined();
    expect(options.token).toBe('sekret');
    // Environment values are dropped by the negative flags too.
    expect(parseRelayArgs(['--no-data'], { DATA_DIR: '/tmp/d' }).dataDir).toBeUndefined();
  });

  it('guards against being orphaned, and can be told not to', () => {
    expect(parseRelayArgs([], {}).orphanGuard).toBe(true);
    expect(parseRelayArgs(['--no-orphan-guard'], {}).orphanGuard).toBe(false);
    expect(RELAY_USAGE).toContain('--no-orphan-guard');
  });

  it('rejects a bad port or an unknown flag with usage, and accepts --help', () => {
    expect(() => parseRelayArgs(['--port', 'nope'], {})).toThrow(/--port needs a number/);
    expect(() => parseRelayArgs(['--port', '70000'], {})).toThrow(/--port needs a number/);
    expect(() => parseRelayArgs(['--wat'], {})).toThrow(/Unknown option "--wat"/);
    expect(() => parseRelayArgs(['--wat'], {})).toThrow(/Usage: vite-node server\/index\.ts/);
    expect(parseRelayArgs(['--help'], {}).help).toBe(true);
    expect(RELAY_USAGE).toContain('--no-data');
  });

  it('reads the capacity bounds from the environment', () => {
    expect(limitsFromEnv({})).toEqual(DEFAULT_LIMITS);
    const limits = limitsFromEnv({ PIGMA_MAX_ROOM_PEERS: '4', PIGMA_SNAPSHOT_TTL_MS: '1000', PIGMA_MAX_ROOM_PEERS_BAD: 'x' });
    expect(limits).toMatchObject({ maxRoomPeers: 4, snapshotTtlMs: 1000, maxConnectionsPerIp: DEFAULT_LIMITS.maxConnectionsPerIp });
  });

  it('prints the URL a browser test can use, resolving 0.0.0.0 to loopback', () => {
    const options = parseRelayArgs(['--port', '0', '--no-static', '--no-data'], {});
    const banner = relayBanner(options, 4321, false).join('\n');
    expect(banner).toContain('pigma collab relay listening on http://127.0.0.1:4321');
    expect(banner).toContain('ws://127.0.0.1:4321/collab?room=default');
    expect(banner).toContain('relay only');
    expect(banner).toContain('snapshots: in memory only');
    // A token is advertised on the room endpoint.
    expect(relayBanner({ ...options, token: 'sekret' }, 4321, false).join('\n')).toContain('&token=sekret');
  });
});

describe('the relay CLI as a process', () => {
  let child: ChildProcess | null = null;
  /** Pid of a relay started by the orphan fixture, killed even if a test fails. */
  let orphanedPid: number | null = null;

  afterEach(() => {
    child?.kill('SIGKILL');
    child = null;
    if (orphanedPid !== null) {
      try {
        process.kill(orphanedPid, 'SIGKILL');
      } catch {
        // already gone: the guard did its job
      }
      orphanedPid = null;
    }
  });

  const waitForPort = (process: ChildProcess, timeoutMs = 30_000): Promise<number> =>
    new Promise((resolve, reject) => {
      let buffer = '';
      const timer = setTimeout(() => reject(new Error(`relay did not report a port; output:\n${buffer}`)), timeoutMs);
      process.stdout?.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        const match = /relay ready (\{[^}]*\})/.exec(buffer);
        if (match) {
          clearTimeout(timer);
          resolve((JSON.parse(match[1] as string) as { port: number }).port);
        }
      });
      process.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`relay exited early with code ${code}; output:\n${buffer}`));
      });
    });

  /** Everything the child printed, for assertions after it exits. */
  const collect = (process: ChildProcess): { stdout: string[]; stderr: string[] } => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    process.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk.toString('utf8')));
    process.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk.toString('utf8')));
    return { stdout, stderr };
  };

  const portFree = (port: number): Promise<boolean> =>
    new Promise((resolve) => {
      const probe = createServer();
      probe.once('error', () => resolve(false));
      probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
    });

  it('exits by itself when its parent dies without signalling (no lingering relay)', async () => {
    // The guard's contract: a relay whose parent goes away *after it started*
    // exits by itself, because nothing will ever signal it again. The fixture
    // starts a relay, reports its port and pid, then exits while leaving it
    // running. The test waits on the **relay process really exiting** — not on a
    // port probe or `lsof`, both of which are slow enough on a loaded box to make
    // a correct run look broken.
    const launcher = fileURLToPath(new URL('./fixtures/orphan-launcher.mjs', import.meta.url));
    const starter = spawn(process.execPath, [launcher, viteNode, repoRoot], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] });
    const launcherErrors: string[] = [];
    starter.stderr?.on('data', (chunk: Buffer) => launcherErrors.push(chunk.toString('utf8')));

    const started = await new Promise<{ port: number; pid: number }>((resolve, reject) => {
      let out = '';
      starter.stdout?.on('data', (chunk: Buffer) => {
        out += chunk.toString('utf8');
        const match = /\{"port":(\d+),"pid":(\d+)\}/.exec(out);
        if (match) resolve({ port: Number(match[1]), pid: Number(match[2]) });
      });
      starter.once('exit', (code) =>
        reject(new Error(`launcher exited (${code}) without reporting the relay: ${launcherErrors.join('')}`)),
      );
      setTimeout(() => reject(new Error(`launcher did not report the relay within 60s; output:\n${out}`)), 60_000);
    });

    /** The relay is gone when its pid no longer exists. */
    const relayAlive = (): boolean => {
      try {
        process.kill(started.pid, 0);
        return true;
      } catch (error) {
        // ESRCH: gone. EPERM would mean it exists but is not ours, which cannot
        // happen here, so treat anything other than "no such process" as alive.
        return (error as NodeJS.ErrnoException).code !== 'ESRCH';
      }
    };

    orphanedPid = started.pid;
    expect(relayAlive(), `relay ${started.pid} should be running before its parent exits`).toBe(true);
    await new Promise<void>((resolve) => starter.once('exit', () => resolve()));

    // Generous bound: the guard checks every 2s, and a loaded box can stretch the
    // shutdown that follows. The condition is the real one — the process is gone.
    const boundMs = 60_000;
    const deadline = Date.now() + boundMs;
    while (relayAlive() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const waited = Date.now() - (deadline - boundMs);
    expect(
      relayAlive(),
      `relay ${started.pid} was still running ${waited}ms after its parent exited (bound ${boundMs}ms); ` +
        `port ${started.port}${(await portFree(started.port)) ? ' is free' : ' is still served'}`,
    ).toBe(false);
    // And its port is released, which is what a browser test needs to reuse it.
    expect(await portFree(started.port)).toBe(true);
  }, 90_000);

  it('starts, serves a room, and exits cleanly on SIGTERM with no orphans', async () => {
    expect(existsSync(viteNode)).toBe(true);
    child = spawn(viteNode, ['server/index.ts', '--port', '0', '--host', '127.0.0.1', '--no-data', '--no-static'], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Its own process group, so a stray signal cannot take the test runner down.
      detached: true,
    });
    const captured = collect(child);

    const port = await waitForPort(child);

    // A real client joins the room the CLI advertised.
    const client = await TestClient.connect(`ws://127.0.0.1:${port}/collab?room=cli-smoke`);
    client.send({ t: 'hello', clientId: 'cli-a', nickname: 'Ada' });
    expect(await client.next('welcome')).toMatchObject({ room: 'cli-smoke', e2e: false });
    const health = (await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.json())) as { ok: boolean; rooms: number };
    expect(health).toMatchObject({ ok: true, rooms: 1 });
    client.close();

    // SIGTERM: a clean exit code, and the port is released.
    const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
      child!.once('exit', (code, signal) => resolve({ code, signal }));
    });
    child.kill('SIGTERM');
    const result = await exited;
    expect(captured.stderr.join('')).toBe('');
    // The shutdown handler ran (rather than the process dying from the signal),
    // and the banner was printed before the room was served.
    expect(captured.stdout.join('')).toContain('relay stopping (SIGTERM)');
    expect(captured.stdout.join('')).toContain('pigma collab relay listening on http://127.0.0.1:');
    expect(result).toEqual({ code: 0, signal: null });

    // Nothing is left listening, and the process itself is gone.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await portFree(port)).toBe(true);
    expect(child.exitCode).toBe(0);
    expect(child.killed).toBe(true);
    child = null;
  }, 60_000);
});
