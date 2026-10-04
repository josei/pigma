/**
 * Relay capacity: per-IP and per-room caps, per-IP rate limits, room GC,
 * snapshot TTL, and the health/metrics surface.
 *
 * Everything here is an abuse bound, not a meter: the defaults are generous and
 * every one of them is overridable. Keys are IP addresses; nothing identifies a
 * person.
 */
import { vi, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RateLimiter, DEFAULT_LIMITS, resolveLimits } from '../../src/collab/limits';
import { startRelay, type RelayHarness } from './harness';

/**
 * These tests drive real sockets, real HTTP and spawned processes. Their subject
 * is protocol behaviour, not latency, so they get a generous per-file bound: a
 * busy box must not turn a slow-but-correct round trip into a failure. It is
 * still a *bound* — a genuine hang fails here, with vitest naming the timeout.
 */
vi.setConfig({ testTimeout: 60_000 });

describe('rate limiter', () => {
  it('allows up to the limit inside a window and refuses after it', () => {
    let now = 0;
    const limiter = new RateLimiter({ limit: 3, windowMs: 1000, now: () => now });
    expect(limiter.capacity).toBe(3);
    expect(limiter.tryConsume('ip')).toBe(true);
    expect(limiter.tryConsume('ip')).toBe(true);
    expect(limiter.tryConsume('ip')).toBe(true);
    expect(limiter.remaining('ip')).toBe(0);
    expect(limiter.tryConsume('ip')).toBe(false);

    // A different key has its own budget.
    expect(limiter.tryConsume('other')).toBe(true);

    // The window rolls over.
    now = 1000;
    expect(limiter.remaining('ip')).toBe(3);
    expect(limiter.tryConsume('ip')).toBe(true);
  });

  it('prunes expired windows so the key map cannot grow forever', () => {
    let now = 0;
    const limiter = new RateLimiter({ limit: 1, windowMs: 500, now: () => now });
    limiter.tryConsume('a');
    limiter.tryConsume('b');
    expect(limiter.size).toBe(2);
    now = 600;
    expect(limiter.prune()).toBe(2);
    expect(limiter.size).toBe(0);
    limiter.tryConsume('a');
    limiter.reset('a');
    expect(limiter.remaining('a')).toBe(1);
  });

  it('ships generous defaults and lets a deployment override them', () => {
    expect(DEFAULT_LIMITS.maxRoomPeers).toBeGreaterThanOrEqual(8);
    expect(DEFAULT_LIMITS.messagesPerWindow / (DEFAULT_LIMITS.messageWindowMs / 1000)).toBeGreaterThanOrEqual(60);
    expect(resolveLimits({ maxRoomPeers: 2 })).toMatchObject({ maxRoomPeers: 2, maxConnectionsPerIp: DEFAULT_LIMITS.maxConnectionsPerIp });
  });
});

describe('relay limits', () => {
  let relay: RelayHarness;
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'pigma-limits-'));
  });

  afterEach(async () => {
    await relay?.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('refuses more open connections from one address than the cap allows', async () => {
    relay = await startRelay({ dataDir, limits: { maxConnectionsPerIp: 2 } });
    const first = await relay.connect('capped');
    const second = await relay.connect('capped');
    first.send({ t: 'hello', clientId: 'a', nickname: 'Ada' });
    second.send({ t: 'hello', clientId: 'b', nickname: 'Grace' });
    await first.next('welcome');
    await second.next('welcome');

    // The third upgrade is refused before the handshake completes.
    expect(await relay.upgradeStatus('capped')).toContain('429');
    expect((await fetch(`${relay.httpBase}/health`).then((r) => r.json())).metrics.connectionsRejected).toBe(1);

    // Closing one frees the slot.
    first.close();
    await new Promise((resolve) => setTimeout(resolve, 150));
    const third = await relay.connect('capped');
    third.send({ t: 'hello', clientId: 'c', nickname: 'Late' });
    await third.next('welcome');
  });

  it('rate-limits connection attempts per address', async () => {
    relay = await startRelay({ limits: { connectionAttemptsPerMinute: 3, maxConnectionsPerIp: 99 } });
    expect(await relay.upgradeStatus('burst')).toContain('101');
    expect(await relay.upgradeStatus('burst')).toContain('101');
    expect(await relay.upgradeStatus('burst')).toContain('101');
    expect(await relay.upgradeStatus('burst')).toContain('429');
  });

  it('caps participants per room and says why', async () => {
    relay = await startRelay({ limits: { maxRoomPeers: 2 } });
    const ada = await relay.connect('full');
    ada.send({ t: 'hello', clientId: 'a', nickname: 'Ada' });
    await ada.next('welcome');
    const grace = await relay.connect('full');
    grace.send({ t: 'hello', clientId: 'b', nickname: 'Grace' });
    await grace.next('welcome');

    const late = await relay.connect('full');
    late.send({ t: 'hello', clientId: 'c', nickname: 'Late' });
    const error = await late.next('error');
    expect(error).toMatchObject({ code: 'room-full' });
    expect(await late.waitForClose()).toMatchObject({ code: 1013 });

    // The room still has exactly its two participants.
    const health = (await fetch(`${relay.httpBase}/health`).then((r) => r.json())) as { participants: number; metrics: { peersRejected: number } };
    expect(health.participants).toBe(2);
    expect(health.metrics.peersRejected).toBe(1);
  });

  it('closes a connection that exceeds the message rate', async () => {
    relay = await startRelay({ limits: { messagesPerWindow: 4, messageWindowMs: 60_000 } });
    const ada = await relay.connect('noisy');
    ada.send({ t: 'hello', clientId: 'a', nickname: 'Ada' });
    await ada.next('welcome');
    // hello + 3 more are allowed; the fifth message trips the limit.
    for (let index = 0; index < 3; index += 1) ada.send({ t: 'cursor', x: index, y: 0 });
    ada.send({ t: 'cursor', x: 99, y: 99 });
    expect(await ada.waitForClose()).toMatchObject({ code: 1008 });
    const health = (await fetch(`${relay.httpBase}/health`).then((r) => r.json())) as { metrics: { rateLimited: number } };
    expect(health.metrics.rateLimited).toBe(1);
  });

  it('sweeps idle empty rooms and expires their snapshots (never a document store)', async () => {
    let now = 1_000_000;
    relay = await startRelay({ dataDir, now: () => now, limits: { roomTtlMs: 1000, snapshotTtlMs: 60_000, gcIntervalMs: 60_000 } });
    const ada = await relay.connect('idle');
    ada.send({ t: 'hello', clientId: 'a', nickname: 'Ada' });
    await ada.next('welcome');
    ada.send({ t: 'snapshot', file: { schema: 'pigma/1', name: 'Doc' }, seq: 1 });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(await readdir(dataDir)).toHaveLength(1);

    ada.close();
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Still inside the TTL: the room and its snapshot survive.
    expect(await relay.server.sweepNow()).toEqual({ rooms: [], snapshots: [] });
    expect(relay.server.snapshotOf('idle')).not.toBeNull();

    // Past the TTL: both go, and the file is removed.
    now += 2000;
    const swept = await relay.server.sweepNow();
    expect(swept.rooms).toEqual(['idle']);
    expect(relay.server.snapshotOf('idle')).toBeNull();
    expect(await readdir(dataDir)).toHaveLength(0);

    // A late joiner therefore converges on nothing rather than a stale document.
    const late = await relay.connect('idle');
    late.send({ t: 'hello', clientId: 'b', nickname: 'Late' });
    expect((await late.next('welcome')).snapshot).toBeNull();
  });

  it('expires a snapshot by TTL even while the room is still live', async () => {
    let now = 2_000_000;
    relay = await startRelay({ dataDir, now: () => now, limits: { snapshotTtlMs: 1000, roomTtlMs: 10 * 60_000, gcIntervalMs: 60_000 } });
    const ada = await relay.connect('live');
    ada.send({ t: 'hello', clientId: 'a', nickname: 'Ada' });
    await ada.next('welcome');
    ada.send({ t: 'snapshot', file: { schema: 'pigma/1' }, seq: 4 });
    await new Promise((resolve) => setTimeout(resolve, 150));

    now += 1500;
    const swept = await relay.server.sweepNow();
    expect(swept.snapshots).toEqual(['live']);
    expect(relay.server.snapshotOf('live')).toBeNull();
    // The room itself is untouched: it still has a participant.
    expect(relay.server.rooms.has('live')).toBe(true);
    expect(await readdir(dataDir)).toHaveLength(0);
  });

  it('reports capacity and counters on /health and /metrics', async () => {
    relay = await startRelay({ limits: { maxRoomPeers: 4, messagesPerWindow: 100, messageWindowMs: 1000 } });
    const ada = await relay.connect('metrics');
    ada.send({ t: 'hello', clientId: 'a', nickname: 'Ada' });
    await ada.next('welcome');
    const grace = await relay.connect('metrics');
    grace.send({ t: 'hello', clientId: 'b', nickname: 'Grace' });
    await grace.next('welcome');
    ada.send({ t: 'cursor', x: 1, y: 2 });
    await grace.next('cursor');

    const health = (await fetch(`${relay.httpBase}/health`).then((r) => r.json())) as Record<string, unknown> & {
      limits: { maxRoomPeers: number };
      metrics: Record<string, number>;
    };
    expect(health).toMatchObject({ ok: true, rooms: 1, participants: 2, connections: 2 });
    expect(health.limits.maxRoomPeers).toBe(4);
    expect(health.metrics.connectionsTotal).toBe(2);
    expect(health.metrics.messagesIn).toBeGreaterThanOrEqual(3);
    expect(health.metrics.messagesOut).toBeGreaterThanOrEqual(1);
    // Still no user/identity surface anywhere in the payload.
    expect(JSON.stringify(health)).not.toMatch(/user|account|session|role|auth|admin/i);

    const text = await (await fetch(`${relay.httpBase}/metrics`)).text();
    expect(text).toContain('# TYPE pigma_rooms gauge');
    expect(text).toContain('pigma_rooms 1');
    expect(text).toContain('pigma_participants 2');
    expect(text).toContain('# TYPE pigma_messages_in_total counter');
    expect(text).toMatch(/pigma_messages_in_total \d+/);
    expect(text).toContain('pigma_snapshots_expired_total');
  });
});
