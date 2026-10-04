/**
 * End-to-end encryption for room payloads.
 *
 * Threat model: the relay is honest-but-curious and may also be compromised. It
 * must be able to route and store a room without being able to read it. Only the
 * document-bearing payloads (`ops`, `snapshot`) are encrypted; presence
 * (nickname, colour, cursor, selection) stays plaintext and is documented as
 * such — see `docs/SELF_HOSTING.md`.
 *
 * Crypto design:
 * - **Key location.** The room key is generated on the client (`generateRoomKey`)
 *   and carried in the URL *fragment* (`#room=…&key=…`). Fragments are never sent
 *   in an HTTP request, and the WebSocket URL is built from the room id only, so
 *   the relay never receives the key.
 * - **Key derivation.** The fragment key is 32 random bytes. It is never used
 *   directly: HKDF-SHA256 derives a per-purpose AES-256-GCM key with the room id
 *   as salt and the purpose as `info` (`doc`). That separates purposes, binds the
 *   key to one room (a key from another room cannot decrypt, even if the raw
 *   bytes leaked), and leaves room for a `presence` key if presence is ever
 *   encrypted too.
 * - **IV/nonce.** A fresh random 96-bit IV per message, prepended to the
 *   ciphertext inside the envelope. Random IVs with a 256-bit key are safe well
 *   past this scale (collision probability ~2^-32 after 2^48 messages); a
 *   counter would be wrong here because several clients encrypt under the same
 *   key.
 * - **Authenticity.** AES-GCM authenticates as well as encrypts, with the room id
 *   and payload kind as additional authenticated data, so a ciphertext cannot be
 *   replayed as another kind or into another room. Tampering, a wrong key, or a
 *   cross-room/cross-kind substitution all fail decryption.
 *
 * What E2E does **not** provide: the relay can still drop, delay, duplicate, or
 * reorder messages (it is the transport), and it sees room ids, participant
 * counts, sequence numbers, sizes and timings. Confidentiality of content, not
 * traffic-analysis resistance.
 */

/** AES-GCM envelope as it travels over the wire. `iv`/`ct` are base64url. */
export interface EncryptedEnvelope {
  /** Envelope version, so the format can change without breaking old clients. */
  v: 1;
  iv: string;
  ct: string;
}

/** What a payload is, bound into the authentication tag. */
export type PayloadKind = 'doc' | 'ops' | 'snapshot';

const KEY_BYTES = 32;
const IV_BYTES = 12;

function subtle(): SubtleCrypto {
  const crypto = globalThis.crypto;
  if (!crypto?.subtle) throw new Error('WebCrypto is unavailable; rooms cannot be encrypted in this environment');
  return crypto.subtle;
}

/** 32 random bytes, the room key as it appears in the URL fragment. */
export function generateRoomKey(): Uint8Array {
  const bytes = new Uint8Array(KEY_BYTES);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

/** Fragment-safe text for the key. */
export function encodeRoomKey(key: Uint8Array): string {
  return toBase64Url(key);
}

/** Parse a key from a fragment. Returns null when it is not a valid 32-byte key. */
export function decodeRoomKey(text: string): Uint8Array | null {
  const bytes = fromBase64Url(text.trim());
  return bytes && bytes.length === KEY_BYTES ? bytes : null;
}

/**
 * Derive the AES-256-GCM key for one purpose in one room. The room id is the
 * HKDF salt, so the same raw key in a different room yields a different key.
 */
export async function deriveRoomKey(rawKey: Uint8Array, roomId: string, purpose: PayloadKind = 'doc'): Promise<CryptoKey> {
  const api = subtle();
  const material = await api.importKey('raw', rawKey as unknown as ArrayBuffer, 'HKDF', false, ['deriveKey']);
  return api.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode(`pigma/room-v1/${roomId}`),
      info: new TextEncoder().encode(purpose),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function aad(roomId: string, kind: PayloadKind): Uint8Array {
  return new TextEncoder().encode(`pigma/room-v1|${roomId}|${kind}`);
}

/** Encrypt any JSON value into a wire envelope. */
export async function encryptPayload(
  key: CryptoKey,
  roomId: string,
  kind: PayloadKind,
  value: unknown,
): Promise<EncryptedEnvelope> {
  const api = subtle();
  const iv = new Uint8Array(IV_BYTES);
  globalThis.crypto.getRandomValues(iv);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await api.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as ArrayBuffer, additionalData: aad(roomId, kind) as unknown as ArrayBuffer },
    key,
    plaintext as unknown as ArrayBuffer,
  );
  return { v: 1, iv: toBase64Url(iv), ct: toBase64Url(new Uint8Array(ciphertext)) };
}

export type DecryptResult<T> = { ok: true; value: T } | { ok: false; reason: 'malformed' | 'failed' };

/**
 * Decrypt a wire envelope. A wrong key, a tampered ciphertext, a mismatched room
 * or a mismatched kind all fail here — the caller decides what to do (the relay
 * never gets this far, because it has no key).
 */
export async function decryptPayload<T>(
  key: CryptoKey,
  roomId: string,
  kind: PayloadKind,
  envelope: unknown,
): Promise<DecryptResult<T>> {
  if (!isEncryptedEnvelope(envelope)) return { ok: false, reason: 'malformed' };
  const iv = fromBase64Url(envelope.iv);
  const ciphertext = fromBase64Url(envelope.ct);
  if (!iv || iv.length !== IV_BYTES || !ciphertext) return { ok: false, reason: 'malformed' };
  try {
    const plaintext = await subtle().decrypt(
      { name: 'AES-GCM', iv: iv as unknown as ArrayBuffer, additionalData: aad(roomId, kind) as unknown as ArrayBuffer },
      key,
      ciphertext as unknown as ArrayBuffer,
    );
    return { ok: true, value: JSON.parse(new TextDecoder().decode(plaintext)) as T };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/** Structural check for a wire envelope. Used by clients and by the relay. */
export function isEncryptedEnvelope(value: unknown): value is EncryptedEnvelope {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const envelope = value as Record<string, unknown>;
  if (envelope.v !== 1) return false;
  if (typeof envelope.iv !== 'string' || typeof envelope.ct !== 'string') return false;
  // 12-byte IV, and a GCM tag is at least 16 bytes: anything shorter is not ours.
  return fromBase64Url(envelope.iv)?.length === IV_BYTES && (fromBase64Url(envelope.ct)?.length ?? 0) >= 16;
}

/** The shareable link: room and key in the fragment, which is never sent to the server. */
export function buildRoomLink(base: string, roomId: string, key: Uint8Array): string {
  const origin = base.trim().replace(/\/+$/, '');
  return `${origin}/#room=${encodeURIComponent(roomId)}&key=${encodeRoomKey(key)}`;
}

/** Parse `#room=…&key=…` (or a full URL containing it). */
export function parseRoomLink(input: string): { roomId: string; key: Uint8Array } | null {
  const hash = input.includes('#') ? input.slice(input.indexOf('#') + 1) : input.replace(/^#/, '');
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  const roomId = params.get('room');
  const key = params.get('key');
  if (!roomId || !key) return null;
  const bytes = decodeRoomKey(key);
  return bytes ? { roomId, key: bytes } : null;
}
