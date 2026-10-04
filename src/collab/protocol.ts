/**
 * Wire protocol for the Pigma collaboration relay.
 *
 * Deliberately minimal: a room relay plus a last-snapshot per room. There is no
 * user model, no accounts, no sessions, and no roles — the only identity on the
 * wire is a random, locally generated `clientId` (used to route messages) and a
 * presentation-only `nickname` (echoed to other clients for cursor labels,
 * never stored server-side, never unique, never validated as identity).
 *
 * Messages are JSON text frames. `ops` and `snapshot.file` are opaque to the
 * server: it relays and stores them without interpreting the editor's document
 * format. In an end-to-end-encrypted room they are AES-GCM envelopes
 * (`src/collab/crypto.ts`) and the relay refuses anything else, so it stores
 * ciphertext or nothing — never a plaintext document.
 *
 * Presence (nickname, colour, cursor, selection) is **plaintext by design**: a
 * nickname is a presentation label the user chose to show other participants,
 * and cursors/selections are what those participants render. They carry no
 * document content (a cursor is a position, a selection is a list of opaque node
 * ids). See `docs/SELF_HOSTING.md` for exactly what an operator can see.
 */

export const COLLAB_PROTOCOL_VERSION = 1;

/** Longest nickname the relay will echo back. Purely a wire bound. */
export const MAX_NICKNAME_LENGTH = 32;
export const DEFAULT_NICKNAME = 'Guest';

export interface Cursor {
  x: number;
  y: number;
}

/** A participant as seen by other clients. Lives in memory for the room's lifetime only. */
export interface Peer {
  clientId: string;
  nickname: string;
  color: string;
  cursor: Cursor | null;
  selection: string[];
}

/**
 * The document range a view may be reported from, in document pixels. Anything
 * further out is off any real document, so a followed peer cannot jerk the view
 * into the void with an extreme offset.
 */
export const MAX_VIEW_COORD = 1_000_000;
export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 256;

/** Keep a zoom inside the canvas's supported range: the one clamp for every zoom. */
export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Keep a viewport inside the documented view range (used for every peer view). */
export function clampViewport(viewport: { x: number; y: number; zoom: number }): {
  x: number;
  y: number;
  zoom: number;
} {
  const clamp = (value: number) => Math.min(MAX_VIEW_COORD, Math.max(-MAX_VIEW_COORD, value));
  return {
    x: clamp(viewport.x),
    y: clamp(viewport.y),
    zoom: clampZoom(viewport.zoom),
  };
}

/** Client -> server. */
export type ClientMessage =
  /** `e2e` declares the room's mode; the relay refuses a mismatch. */
  | { t: 'hello'; clientId: string; nickname: string; e2e?: boolean }
  | { t: 'cursor'; x: number; y: number }
  /** The sender's viewport, so a peer can follow it. Presence, not document data. */
  | { t: 'viewport'; x: number; y: number; zoom: number }
  | { t: 'selection'; ids: string[] }
  /** Opaque: an ops array in plaintext mode, an AES-GCM envelope in E2E mode. */
  | { t: 'ops'; ops: unknown; seq?: number }
  | { t: 'snapshot'; file: unknown; seq: number }
  | { t: 'ping' };

/** Server -> client. */
export type ServerMessage =
  | {
      t: 'welcome';
      protocol: number;
      room: string;
      /** Whether this room's document payloads are end-to-end encrypted. */
      e2e: boolean;
      self: Peer;
      peers: Peer[];
      /** Server-assigned sequence for this room; `snapshot.seq` is the last one it covers. */
      seq: number;
      snapshot: { file: unknown; seq: number } | null;
    }
  | { t: 'peer-join'; peer: Peer }
  | { t: 'peer-leave'; clientId: string }
  | { t: 'cursor'; clientId: string; nickname: string; color: string; x: number; y: number }
  | { t: 'viewport'; clientId: string; x: number; y: number; zoom: number }
  | { t: 'selection'; clientId: string; nickname: string; color: string; ids: string[] }
  /** Relayed verbatim: an ops array, or an AES-GCM envelope in an E2E room. */
  | { t: 'ops'; clientId: string; ops: unknown; seq: number }
  | { t: 'snapshot'; clientId: string | null; file: unknown; seq: number }
  | { t: 'error'; code: string; message: string }
  | { t: 'pong' };

export function encodeMessage(message: ServerMessage): string {
  return JSON.stringify(message);
}

/**
 * Local, deliberate: the relay stays self-contained (no model/store imports),
 * so it carries its own one-line guard rather than reaching into the editor's
 * `isRecord` helpers. Keep it that way — this module must stay importable by
 * anything that can host a room.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Bound a nickname for the wire: trim, cap the length, fall back to `Guest`.
 * This is not validation of identity — nicknames are never unique, never
 * checked against anything, and never persisted.
 */
export function normalizeNickname(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_NICKNAME;
  const trimmed = value.trim().replace(/\s+/g, ' ').slice(0, MAX_NICKNAME_LENGTH);
  return trimmed.length > 0 ? trimmed : DEFAULT_NICKNAME;
}

/**
 * Derive a stable cursor colour from a clientId. Deterministic and stateless:
 * every participant computes the same colour for the same id, so nothing about
 * the colour needs to be stored or agreed.
 *
 * Two colour schemes exist on purpose, at different scopes:
 * - this one (`hsl` from an FNV-1a hash of the id) is the *relay's* colour. It
 *   is computed once by the room and sent to peers in `welcome`/`cursor`/
 *   `selection`, so every client labels a peer identically;
 * - `src/store/presence.ts` `peerColor` (a six-entry hex palette, different
 *   hash) is the *local* fallback for tabs that never went through the relay.
 *
 * They are not interchangeable, and no unification is wanted: a client must use
 * the relay-provided `color` verbatim when it has one and fall back to
 * `peerColor` only for local-only peers (which is exactly what
 * `src/store/presence.ts` does when it reads `peer.color`).
 */
export function deriveColor(clientId: string): string {
  let hash = 2166136261;
  for (let index = 0; index < clientId.length; index += 1) {
    hash ^= clientId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}

/** Bound a clientId: the relay only uses it to route messages. */
export function normalizeClientId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, 64);
  return trimmed.length > 0 ? trimmed : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown, limit = 1000): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string') ids.push(entry);
    if (ids.length >= limit) break;
  }
  return ids;
}

/**
 * Parse one client frame. Returns null for anything malformed or unknown, so
 * the caller can ignore it (the relay never guesses at intent).
 */
export function decodeClientMessage(raw: string): ClientMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  switch (parsed.t) {
    case 'hello': {
      const clientId = normalizeClientId(parsed.clientId);
      if (!clientId) return null;
      return {
        t: 'hello',
        clientId,
        nickname: normalizeNickname(parsed.nickname),
        ...(typeof parsed.e2e === 'boolean' ? { e2e: parsed.e2e } : {}),
      };
    }
    case 'cursor': {
      const x = finiteNumber(parsed.x);
      const y = finiteNumber(parsed.y);
      if (x === null || y === null) return null;
      return { t: 'cursor', x, y };
    }
    case 'viewport': {
      const x = finiteNumber(parsed.x);
      const y = finiteNumber(parsed.y);
      const zoom = finiteNumber(parsed.zoom);
      if (x === null || y === null || zoom === null || zoom <= 0) return null;
      return { t: 'viewport', ...clampViewport({ x, y, zoom }) };
    }
    case 'selection':
      return { t: 'selection', ids: stringArray(parsed.ids) };
    case 'ops': {
      // Opaque: an array in plaintext mode, an envelope object under E2E.
      if (parsed.ops === undefined || parsed.ops === null) return null;
      const seq = finiteNumber(parsed.seq);
      return { t: 'ops', ops: parsed.ops, ...(seq === null ? {} : { seq }) };
    }
    case 'snapshot': {
      const seq = finiteNumber(parsed.seq);
      if (seq === null || parsed.file === undefined) return null;
      return { t: 'snapshot', file: parsed.file, seq };
    }
    case 'ping':
      return { t: 'ping' };
    default:
      return null;
  }
}
