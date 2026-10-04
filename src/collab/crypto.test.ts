/**
 * Room crypto: key handling, derivation, envelope round trips, and every way a
 * payload can fail to authenticate.
 */
import { describe, expect, it } from 'vitest';
import {
  buildRoomLink,
  decodeRoomKey,
  decryptPayload,
  deriveRoomKey,
  encodeRoomKey,
  encryptPayload,
  generateRoomKey,
  isEncryptedEnvelope,
  parseRoomLink,
} from './crypto';

describe('room keys', () => {
  it('generates 32-byte keys that survive the fragment encoding', () => {
    const key = generateRoomKey();
    expect(key).toHaveLength(32);
    const encoded = encodeRoomKey(key);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeRoomKey(encoded)).toEqual(key);
    // Two keys differ.
    expect(encodeRoomKey(generateRoomKey())).not.toBe(encoded);
  });

  it('rejects keys that are not 32 bytes', () => {
    expect(decodeRoomKey('')).toBeNull();
    expect(decodeRoomKey('not base64!')).toBeNull();
    expect(decodeRoomKey(encodeRoomKey(new Uint8Array(16)))).toBeNull();
  });

  it('carries the key in the fragment, never in the query', () => {
    const key = generateRoomKey();
    const link = buildRoomLink('https://getpigma.com/', 'studio', key);
    expect(link).toBe(`https://getpigma.com/#room=studio&key=${encodeRoomKey(key)}`);
    // A fragment is not sent to a server, which is the whole point.
    expect(new URL(link).search).toBe('');
    expect(parseRoomLink(link)).toMatchObject({ roomId: 'studio' });
    expect(parseRoomLink(link)?.key).toEqual(key);
    expect(parseRoomLink('#room=studio&key=nope')).toBeNull();
    expect(parseRoomLink('')).toBeNull();
  });
});

describe('payload encryption', () => {
  it('round trips a document through AES-GCM', async () => {
    const key = generateRoomKey();
    const doc = await deriveRoomKey(key, 'studio', 'doc');
    const value = { schema: 'pigma/1', name: 'Private', document: { children: [{ id: '1:2' }] } };
    const envelope = await encryptPayload(doc, 'studio', 'snapshot', value);

    expect(isEncryptedEnvelope(envelope)).toBe(true);
    expect(envelope.v).toBe(1);
    // The envelope carries no plaintext of the document.
    expect(JSON.stringify(envelope)).not.toContain('Private');
    expect(JSON.stringify(envelope)).not.toContain('1:2');

    const opened = await decryptPayload<typeof value>(doc, 'studio', 'snapshot', envelope);
    expect(opened).toEqual({ ok: true, value });
  });

  it('uses a fresh IV per message', async () => {
    const key = generateRoomKey();
    const doc = await deriveRoomKey(key, 'studio', 'doc');
    const first = await encryptPayload(doc, 'studio', 'ops', [1, 2, 3]);
    const second = await encryptPayload(doc, 'studio', 'ops', [1, 2, 3]);
    expect(first.iv).not.toBe(second.iv);
    expect(first.ct).not.toBe(second.ct);
    // Both still decrypt.
    expect((await decryptPayload(doc, 'studio', 'ops', first)).ok).toBe(true);
    expect((await decryptPayload(doc, 'studio', 'ops', second)).ok).toBe(true);
  });

  it('fails on a wrong key, a wrong room, a wrong kind, or a tampered ciphertext', async () => {
    const key = generateRoomKey();
    const doc = await deriveRoomKey(key, 'studio', 'doc');
    const envelope = await encryptPayload(doc, 'studio', 'ops', [{ op: 'patch' }]);

    const wrongKey = await deriveRoomKey(generateRoomKey(), 'studio', 'doc');
    expect(await decryptPayload(wrongKey, 'studio', 'ops', envelope)).toEqual({ ok: false, reason: 'failed' });

    // Same raw key, different room: the room id is the HKDF salt.
    const otherRoom = await deriveRoomKey(key, 'other-room', 'doc');
    expect(await decryptPayload(otherRoom, 'other-room', 'ops', envelope)).toEqual({ ok: false, reason: 'failed' });

    // Same room and key, different purpose: bound as additional data.
    expect(await decryptPayload(doc, 'studio', 'snapshot', envelope)).toEqual({ ok: false, reason: 'failed' });

    // One flipped byte in the ciphertext is enough.
    const tampered = { ...envelope, ct: `${envelope.ct.slice(0, -2)}${envelope.ct.slice(-2) === 'AA' ? 'BB' : 'AA'}` };
    expect(await decryptPayload(doc, 'studio', 'ops', tampered)).toEqual({ ok: false, reason: 'failed' });
  });

  it('rejects malformed envelopes without throwing', async () => {
    const doc = await deriveRoomKey(generateRoomKey(), 'studio', 'doc');
    for (const value of [null, 42, 'text', [], {}, { v: 2, iv: 'aa', ct: 'bb' }, { v: 1, iv: 'aa' }, { v: 1, iv: 'aa', ct: 'bb' }]) {
      expect(isEncryptedEnvelope(value)).toBe(false);
      expect(await decryptPayload(doc, 'studio', 'ops', value)).toEqual({ ok: false, reason: 'malformed' });
    }
  });

  it('encrypts a plaintext array in plaintext mode identically to the wire shape', async () => {
    // A plaintext room keeps sending arrays; the envelope check is what tells
    // them apart, so the relay can refuse the former in an encrypted room.
    const doc = await deriveRoomKey(generateRoomKey(), 'studio', 'doc');
    const envelope = await encryptPayload(doc, 'studio', 'ops', []);
    expect(isEncryptedEnvelope([])).toBe(false);
    expect(isEncryptedEnvelope(envelope)).toBe(true);
  });
});
