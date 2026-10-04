/**
 * End-to-end encryption, proven at the relay boundary.
 *
 * The claim under test: the relay routes and stores ciphertext it cannot read.
 * These tests therefore inspect what the *server* holds — the relayed frames, the
 * stored snapshot and the file on disk — and assert that none of them contains
 * the document, while two clients with the room key still converge.
 */
import { vi, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decryptPayload, deriveRoomKey, encryptPayload, encodeRoomKey, generateRoomKey, isEncryptedEnvelope } from '../../src/collab/crypto';
import { startRelay, type RelayHarness } from './harness';

/**
 * These tests drive real sockets, real HTTP and spawned processes. Their subject
 * is protocol behaviour, not latency, so they get a generous per-file bound: a
 * busy box must not turn a slow-but-correct round trip into a failure. It is
 * still a *bound* — a genuine hang fails here, with vitest naming the timeout.
 */
vi.setConfig({ testTimeout: 60_000 });

/** A document with a marker that must never appear in relay-side bytes. */
const SECRET = 'TOP-SECRET-DOCUMENT-TEXT-9f3a';
const document = { schema: 'pigma/1', name: SECRET, document: { id: '0:0', type: 'DOCUMENT', children: [] } };
const ops = [{ op: 'patch', id: '1:2', patch: { name: SECRET } }];

let relay: RelayHarness;
let dataDir: string;
let key: Uint8Array;
let keyText: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'pigma-e2e-'));
  relay = await startRelay({ dataDir });
  key = generateRoomKey();
  keyText = encodeRoomKey(key);
});

afterEach(async () => {
  await relay.close();
  await rm(dataDir, { recursive: true, force: true });
});

/** Join an encrypted room as a plain protocol client (no client-side crypto). */
async function joinE2E(clientId: string, nickname: string, room = 'secret-room') {
  const client = await relay.connect(room);
  client.send({ t: 'hello', clientId, nickname, e2e: true });
  const welcome = await client.next('welcome');
  return { client, welcome };
}

describe('the relay only ever sees ciphertext', () => {
  it('stores and relays an encrypted snapshot without the document', async () => {
    const docKey = await deriveRoomKey(key, 'secret-room', 'doc');
    const { client: ada } = await joinE2E('client-a', 'Ada');
    const { client: grace, welcome } = await joinE2E('client-b', 'Grace');
    expect(welcome.e2e).toBe(true);

    const envelope = await encryptPayload(docKey, 'secret-room', 'snapshot', document);
    ada.send({ t: 'snapshot', file: envelope, seq: 1 });

    // What Grace receives is the envelope, byte for byte.
    const relayed = await grace.next('snapshot');
    expect(relayed.file).toEqual(envelope);
    expect(isEncryptedEnvelope(relayed.file)).toBe(true);
    expect(JSON.stringify(relayed)).not.toContain(SECRET);

    // What the relay holds is the same envelope.
    await new Promise((resolve) => setTimeout(resolve, 150));
    const stored = relay.server.snapshotOf('secret-room');
    expect(stored?.file).toEqual(envelope);
    expect(JSON.stringify(stored)).not.toContain(SECRET);
    expect(isEncryptedEnvelope(stored?.file)).toBe(true);

    // And so is what it wrote to disk.
    const files = await readdir(dataDir);
    expect(files).toEqual(['secret-room.json']);
    const onDisk = await readFile(join(dataDir, files[0] as string), 'utf8');
    expect(onDisk).not.toContain(SECRET);
    expect(isEncryptedEnvelope((JSON.parse(onDisk) as { file: unknown }).file)).toBe(true);

    // Grace decrypts it with the room key.
    const opened = await decryptPayload<typeof document>(docKey, 'secret-room', 'snapshot', relayed.file);
    expect(opened).toEqual({ ok: true, value: document });
  });

  it('relays encrypted ops without the edits', async () => {
    const docKey = await deriveRoomKey(key, 'secret-room', 'doc');
    const { client: ada } = await joinE2E('client-a', 'Ada');
    const { client: grace } = await joinE2E('client-b', 'Grace');

    const envelope = await encryptPayload(docKey, 'secret-room', 'ops', ops);
    ada.send({ t: 'ops', ops: envelope });

    const relayed = await grace.next('ops');
    expect(relayed.ops).toEqual(envelope);
    expect(relayed.seq).toBe(1);
    expect(JSON.stringify(relayed)).not.toContain(SECRET);
    expect(isEncryptedEnvelope(relayed.ops)).toBe(true);
    // The relay's own state carries no plaintext either.
    expect(JSON.stringify(relay.server.rooms.get('secret-room').lastSnapshot())).not.toContain(SECRET);

    const opened = await decryptPayload<typeof ops>(docKey, 'secret-room', 'ops', relayed.ops);
    expect(opened).toEqual({ ok: true, value: ops });
  });

  it('cannot decrypt what it stores (no key, and a wrong key fails)', async () => {
    const docKey = await deriveRoomKey(key, 'secret-room', 'doc');
    const { client: ada } = await joinE2E('client-a', 'Ada');
    const envelope = await encryptPayload(docKey, 'secret-room', 'snapshot', document);
    ada.send({ t: 'snapshot', file: envelope, seq: 1 });
    await new Promise((resolve) => setTimeout(resolve, 150));

    const stored = relay.server.snapshotOf('secret-room')?.file;
    // A relay-side guess at the key does not open it.
    const guess = await deriveRoomKey(generateRoomKey(), 'secret-room', 'doc');
    expect(await decryptPayload(guess, 'secret-room', 'snapshot', stored)).toEqual({ ok: false, reason: 'failed' });
    // The relay's public surface has no key material or decrypt helper at all.
    expect(Object.keys(relay.server)).toEqual(expect.arrayContaining(['rooms', 'snapshotOf', 'listen', 'close']));
    expect(Object.keys(relay.server)).not.toEqual(expect.arrayContaining(['key', 'decrypt', 'decryptPayload']));
    // Only the room key opens it.
    expect((await decryptPayload(docKey, 'secret-room', 'snapshot', stored)).ok).toBe(true);
  });

  it('keeps the key out of the connection entirely', async () => {
    const { client } = await joinE2E('client-a', 'Ada');
    // The key travels in the URL fragment of the share link, which is never sent
    // to the relay: the socket URL carries the room id only, and no message
    // contains the key.
    expect(keyText).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(JSON.stringify(client.received())).not.toContain(keyText);
  });

  it('refuses a plaintext snapshot in an encrypted room, and stores nothing', async () => {
    const { client: ada } = await joinE2E('client-a', 'Ada');
    ada.send({ t: 'snapshot', file: document, seq: 1 });

    const error = await ada.next('error');
    expect(error).toMatchObject({ code: 'plaintext-rejected' });
    expect(await ada.waitForClose()).toMatchObject({ code: 1008 });

    expect(relay.server.snapshotOf('secret-room')).toBeNull();
    expect(await readdir(dataDir)).toHaveLength(0);
    const health = (await fetch(`${relay.httpBase}/health`).then((r) => r.json())) as { metrics: { plaintextRejected: number } };
    expect(health.metrics.plaintextRejected).toBe(1);
  });

  it('refuses plaintext ops in an encrypted room', async () => {
    const { client: ada } = await joinE2E('client-a', 'Ada');
    ada.send({ t: 'ops', ops });
    const error = await ada.next('error');
    expect(error).toMatchObject({ code: 'plaintext-rejected' });
    expect(await ada.waitForClose()).toMatchObject({ code: 1008 });
  });

  it('refuses a plaintext client in an encrypted room (and the reverse)', async () => {
    await joinE2E('client-a', 'Ada');

    const plaintext = await relay.connect('secret-room');
    plaintext.send({ t: 'hello', clientId: 'client-c', nickname: 'Plain' });
    const error = await plaintext.next('error');
    expect(error).toMatchObject({ code: 'mode-mismatch' });
    expect(await plaintext.waitForClose()).toMatchObject({ code: 1008 });

    // A fresh plaintext room refuses an encrypted client for the same reason.
    const plainRoom = await relay.connect('plain-room');
    plainRoom.send({ t: 'hello', clientId: 'client-d', nickname: 'Plain' });
    await plainRoom.next('welcome');
    const encrypted = await relay.connect('plain-room');
    encrypted.send({ t: 'hello', clientId: 'client-e', nickname: 'Cipher', e2e: true });
    expect(await encrypted.next('error')).toMatchObject({ code: 'mode-mismatch' });
  });

  it('still carries presence in plaintext, as documented', async () => {
    const { client: ada } = await joinE2E('client-a', 'Ada');
    const { client: grace } = await joinE2E('client-b', 'Grace');
    grace.send({ t: 'cursor', x: 12, y: 34 });
    grace.send({ t: 'selection', ids: ['1:2'] });

    // Presence is plaintext by design: a nickname is a label, a cursor is a
    // position, and a selection is opaque ids — none of them is document content.
    const cursor = await ada.next('cursor');
    expect(cursor).toMatchObject({ clientId: 'client-b', nickname: 'Grace', x: 12, y: 34 });
    expect((await ada.next('selection')).ids).toEqual(['1:2']);
  });
});

describe('two clients converge through the relay', () => {
  it('decrypts a round trip: A encrypts, the relay forwards, B reads', async () => {
    const docKey = await deriveRoomKey(key, 'secret-room', 'doc');
    const { client: ada } = await joinE2E('client-a', 'Ada');
    const { client: grace, welcome } = await joinE2E('client-b', 'Grace');

    // B starts from the room's snapshot (A published one before B joined).
    const published = await encryptPayload(docKey, 'secret-room', 'snapshot', document);
    ada.send({ t: 'snapshot', file: published, seq: 1 });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const late = await joinE2E('client-c', 'Late');
    expect(late.welcome.snapshot?.file).toEqual(published);
    expect((await decryptPayload(docKey, 'secret-room', 'snapshot', late.welcome.snapshot?.file)).ok).toBe(true);

    // B receives an op batch and reads the edit.
    const batch = await encryptPayload(docKey, 'secret-room', 'ops', ops);
    ada.send({ t: 'ops', ops: batch });
    const relayed = await grace.next('ops');
    const opened = await decryptPayload<typeof ops>(docKey, 'secret-room', 'ops', relayed.ops);
    expect(opened).toEqual({ ok: true, value: ops });
    expect(welcome.e2e).toBe(true);
  });

  it('reports a payload it cannot decrypt instead of applying it', async () => {
    const { client: grace } = await joinE2E('client-b', 'Grace');
    // A batch encrypted with a different room key (i.e. a wrong or stale key).
    const otherKey = await deriveRoomKey(generateRoomKey(), 'secret-room', 'doc');
    const foreign = await encryptPayload(otherKey, 'secret-room', 'ops', ops);
    // The relay forwards it (it cannot tell), and the client must not apply it.
    const opened = await decryptPayload(await deriveRoomKey(key, 'secret-room', 'doc'), 'secret-room', 'ops', foreign);
    expect(opened).toEqual({ ok: false, reason: 'failed' });
    expect(grace.received().length).toBeGreaterThanOrEqual(1);
  });
});
