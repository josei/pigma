/**
 * Collaboration relay tests with real WebSocket clients.
 *
 * The relay is exercised over a real socket: Node's built-in `WebSocket` client
 * for the relay behaviour, and a raw hand-rolled client in
 * `tests/collab/websocket.test.ts` for the framing edge cases.
 *
 * The no-account guarantee is asserted here too: no auth/user surface exists,
 * and no nickname is ever stored.
 */
import { vi, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { safeRoomId, type CollabServer, type CollabServerOptions } from '../../src/collab/server';
import { deriveColor } from '../../src/collab/protocol';
import { TestClient, startRelay, type RelayHarness } from './harness';

/**
 * These tests drive real sockets, real HTTP and spawned processes. Their subject
 * is protocol behaviour, not latency, so they get a generous per-file bound: a
 * busy box must not turn a slow-but-correct round trip into a failure. It is
 * still a *bound* — a genuine hang fails here, with vitest naming the timeout.
 */
vi.setConfig({ testTimeout: 60_000 });

let relay: RelayHarness;
let server: CollabServer;
let base: string;
let httpBase: string;
let dataDir: string;

/** (Re)start the relay under test; `base`/`httpBase` follow the new port. */
async function start(options: CollabServerOptions = {}): Promise<void> {
  relay = await startRelay(options);
  server = relay.server;
  base = relay.wsBase;
  httpBase = relay.httpBase;
}

async function connect(room = 'room-1', token?: string): Promise<TestClient> {
  return relay.connect(room, token);
}

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'pigma-collab-'));
  await start({ dataDir });
});

afterEach(async () => {
  await relay.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe('collab relay', () => {
  it('relays cursors and selection between two nicknames', async () => {
    const ada = await connect();
    ada.send({ t: 'hello', clientId: 'client-a', nickname: 'Ada' });
    const welcomeA = await ada.next('welcome');
    expect(welcomeA).toMatchObject({ protocol: 1, room: 'room-1', seq: 0, snapshot: null });
    expect(welcomeA.peers).toEqual([]);

    const grace = await connect();
    grace.send({ t: 'hello', clientId: 'client-b', nickname: 'Grace' });
    const welcomeB = await grace.next('welcome');
    expect(welcomeB.peers.map((peer) => peer.nickname)).toEqual(['Ada']);
    expect(welcomeB.peers[0]?.color).toBe(deriveColor('client-a'));

    // Ada is told Grace joined, with her derived colour.
    const join = await ada.next('peer-join');
    expect(join.peer).toMatchObject({ clientId: 'client-b', nickname: 'Grace', color: deriveColor('client-b') });
    expect(join.peer.color).not.toBe(welcomeB.peers[0]?.color);

    // Cursor and selection carry the nickname for labels.
    grace.send({ t: 'cursor', x: 120.5, y: 40 });
    const cursor = await ada.next('cursor');
    expect(cursor).toMatchObject({ clientId: 'client-b', nickname: 'Grace', color: deriveColor('client-b'), x: 120.5, y: 40 });

    grace.send({ t: 'selection', ids: ['1:2', '1:3'] });
    const selection = await ada.next('selection');
    expect(selection).toMatchObject({ clientId: 'client-b', nickname: 'Grace', ids: ['1:2', '1:3'] });

    // Presence is never echoed back to the sender.
    expect(grace.received().some((m) => m.t === 'cursor')).toBe(false);
  });

  it('relays document ops and converges a late joiner on the last snapshot', async () => {
    const ada = await connect();
    ada.send({ t: 'hello', clientId: 'client-a', nickname: 'Ada' });
    await ada.next('welcome');

    const grace = await connect();
    grace.send({ t: 'hello', clientId: 'client-b', nickname: 'Grace' });
    await grace.next('welcome');

    // Ada moves a layer; the op reaches Grace with a server-assigned sequence.
    ada.send({ t: 'ops', ops: [{ op: 'patch', id: '1:2', patch: { x: 10 } }] });
    const relayed = await grace.next('ops');
    expect(relayed.seq).toBe(1);
    expect(relayed.ops).toEqual([{ op: 'patch', id: '1:2', patch: { x: 10 } }]);
    expect(ada.received().some((m) => m.t === 'ops')).toBe(false);

    // Grace applies it and publishes the resulting snapshot.
    const snapshot = { schema: 'pigma/1', name: 'Doc', document: { id: '0:0', type: 'DOCUMENT', children: [] } };
    grace.send({ t: 'snapshot', file: snapshot, seq: relayed.seq });
    await ada.next('snapshot');

    // A late joiner converges: it receives the snapshot, and every op it might
    // also receive has a sequence at or below the snapshot's.
    const late = await connect();
    late.send({ t: 'hello', clientId: 'client-c', nickname: 'Late' });
    const welcomeLate = await late.next('welcome');
    expect(welcomeLate.snapshot).toEqual({ file: snapshot, seq: 1 });
    expect(welcomeLate.seq).toBe(1);
    expect(relayed.seq).toBeLessThanOrEqual(welcomeLate.snapshot!.seq);

    // …and peers see the late joiner.
    const joinLate = await ada.next('peer-join', (m) => m.peer.clientId === 'client-c');
    expect(joinLate.peer.nickname).toBe('Late');
  });

  it('broadcasts departures and prunes an empty room with no snapshot', async () => {
    const ada = await connect('ephemeral');
    ada.send({ t: 'hello', clientId: 'client-a', nickname: 'Ada' });
    await ada.next('welcome');
    const grace = await connect('ephemeral');
    grace.send({ t: 'hello', clientId: 'client-b', nickname: 'Grace' });
    await ada.next('peer-join');

    grace.close();
    const left = await ada.next('peer-leave');
    expect(left.clientId).toBe('client-b');

    ada.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(server.rooms.has('ephemeral')).toBe(false);
  });

  it('answers ping with pong', async () => {
    const ada = await connect();
    ada.send({ t: 'hello', clientId: 'client-a', nickname: 'Ada' });
    await ada.next('welcome');
    ada.send({ t: 'ping' });
    await ada.next('pong');
  });

  it('requires hello before relaying, and rejects garbage without dropping the socket', async () => {
    const ada = await connect();
    ada.send({ t: 'cursor', x: 1, y: 1 });
    const error = await ada.next('error');
    expect(error.code).toBe('not-joined');

    ada.socket.send('not json at all');
    ada.send({ t: 'hello', clientId: 'client-a', nickname: 'Ada' });
    const welcome = await ada.next('welcome');
    expect(welcome.self.nickname).toBe('Ada');
  });

  it('gates the room behind an optional token, and needs no token when unset', async () => {
    await relay.close();
    await start({ token: 'sekret', dataDir });

    await expect(TestClient.connect(`${base}/collab?room=locked`)).rejects.toThrow(/failed to connect|closed before open/);

    const allowed = await connect('locked', 'sekret');
    allowed.send({ t: 'hello', clientId: 'client-a', nickname: 'Ada' });
    expect((await allowed.next('welcome')).room).toBe('locked');

    await expect(TestClient.connect(`${base}/collab?room=locked&token=wrong`)).rejects.toThrow(/failed to connect|closed before open/);
  });

  it('keeps nicknames out of the persisted snapshot', async () => {
    const ada = await connect('persisted');
    ada.send({ t: 'hello', clientId: 'client-a', nickname: 'Ada' });
    await ada.next('welcome');
    const grace = await connect('persisted');
    grace.send({ t: 'hello', clientId: 'client-b', nickname: 'Grace' });
    await grace.next('welcome');

    ada.send({ t: 'snapshot', file: { schema: 'pigma/1', name: 'Doc' }, seq: 1 });
    // The snapshot is relayed to other participants and stored server-side.
    const relayed = await grace.next('snapshot');
    expect(relayed).toMatchObject({ clientId: 'client-a', seq: 1 });

    // Give the atomic write a moment to land.
    await new Promise((resolve) => setTimeout(resolve, 150));
    const files = await readdir(dataDir);
    expect(files).toEqual([`${safeRoomId('persisted')}.json`]);
    const raw = await readFile(join(dataDir, files[0] as string), 'utf8');
    expect(raw).not.toContain('Ada');
    expect(JSON.parse(raw)).toEqual({ file: { schema: 'pigma/1', name: 'Doc' }, seq: 1 });
  });

  it('serves static assets, and nothing else', async () => {
    const staticDir = await mkdtemp(join(tmpdir(), 'pigma-static-'));
    await writeFile(join(staticDir, 'index.html'), '<!doctype html><title>Pigma</title>');
    await mkdir(join(staticDir, 'assets'), { recursive: true });
    await writeFile(join(staticDir, 'assets', 'app.js'), 'console.log("pigma");');

    await relay.close();
    await start({ staticDir, dataDir });

    expect(await (await fetch(`${httpBase}/`)).text()).toContain('Pigma');
    expect((await fetch(`${httpBase}/assets/app.js`)).headers.get('content-type')).toContain('text/javascript');
    // No SPA fallback: an unknown path is a 404, never the app shell.
    expect((await fetch(`${httpBase}/some/route`)).status).toBe(404);
    // Path traversal neither escapes the asset root nor leaks a file from it.
    const traversal = await fetch(`${httpBase}/../package.json`);
    expect(traversal.status).toBe(404);
    expect(await traversal.text()).not.toContain('"name": "pigma"');
    await rm(staticDir, { recursive: true, force: true });
  });
});

describe('no-account guarantee', () => {
  it('exposes no auth or user endpoints', async () => {
    const probes = ['/login', '/signup', '/signup.html', '/auth', '/auth/login', '/auth/token', '/users', '/api/users', '/api/me', '/me', '/session', '/sessions', '/profile', '/admin'];
    for (const path of probes) {
      const response = await fetch(`${httpBase}${path}`);
      expect(`${path} -> ${response.status}`).toBe(`${path} -> 404`);
    }
    // Only liveness and capacity are exposed, and they carry no user data.
    const health = (await (await fetch(`${httpBase}/health`)).json()) as Record<string, unknown>;
    expect(health).toMatchObject({ ok: true, rooms: 0, participants: 0, connections: 0, snapshots: 0 });
    expect(Object.keys(health)).toEqual(
      expect.arrayContaining(['ok', 'uptimeMs', 'rooms', 'participants', 'connections', 'snapshots', 'limits', 'metrics']),
    );
    expect(JSON.stringify(health)).not.toMatch(/user|account|session|role|auth|admin/i);

    // No write surface at all.
    expect((await fetch(`${httpBase}/login`, { method: 'POST' })).status).toBe(405);
  });

  it('keeps only a room relay in its public surface', () => {
    const api = Object.keys(server).sort();
    expect(api).toEqual(['close', 'limits', 'listen', 'rooms', 'server', 'snapshotOf', 'sweepNow']);
    // The relay has no notion of a user, session, role, or account.
    expect(JSON.stringify(api)).not.toMatch(/user|account|session|role|auth|admin/i);
  });

  it('holds nicknames only as live presence, never in room state', async () => {
    const ada = await connect('presence');
    ada.send({ t: 'hello', clientId: 'client-a', nickname: 'Ada' });
    await ada.next('welcome');
    const grace = await connect('presence');
    grace.send({ t: 'hello', clientId: 'client-b', nickname: 'Grace' });
    await ada.next('peer-join');

    // The room knows the nicknames only while the sockets are open…
    const room = server.rooms.get('presence');
    expect(room.peers().map((peer) => peer.nickname).sort()).toEqual(['Ada', 'Grace']);
    expect(room.lastSnapshot()).toBeNull();

    // …and forgets them when everyone leaves.
    ada.close();
    grace.close();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(server.rooms.has('presence')).toBe(false);
    expect(server.snapshotOf('presence')).toBeNull();
  });
});
