import { decodeRoomKey, decryptPayload, deriveRoomKey, encryptPayload } from './crypto';
import {
  DEFAULT_NICKNAME,
  deriveColor,
  normalizeNickname,
  type ClientMessage,
  type Cursor,
  type Peer,
  type ServerMessage,
} from './protocol';
import type { Viewport } from '../store/editorStore';

/**
 * Rooms client (M13).
 *
 * The editor joins an existing relay room as one more WebSocket peer. Everything
 * here is local-first: with no room joined nothing connects, nothing is sent and
 * the editor behaves exactly as it does offline. The relay carries presence
 * (nickname, cursor, selection) — it has no accounts, no identity and no
 * document merge, and this client does not pretend otherwise: remote documents
 * are never applied, only shown.
 *
 * Document payloads (ops and snapshots) are end-to-end encrypted: the room key
 * travels in the URL fragment, the relay only ever sees AES-GCM envelopes, and a
 * room whose key is missing is **refused** unless the caller explicitly opts into
 * the labelled plaintext mode.
 */

export type RoomPhase = 'offline' | 'connecting' | 'online' | 'error';

export interface RoomPeerState {
  clientId: string;
  nickname: string;
  color: string;
  cursor: Cursor | null;
  selection: string[];
  /** The peer's viewport, when they have shared one (used by follow mode). */
  viewport: { x: number; y: number; zoom: number } | null;
}

export type RoomMode = 'e2e' | 'plaintext';

export interface RoomState {
  phase: RoomPhase;
  /** Whether this room's document payloads are encrypted. `null` before a join. */
  mode: RoomMode | null;
  /** Room the editor is in, or null when working alone. */
  roomId: string | null;
  /** Relay the room was joined on (the effective URL, for display). */
  base: string | null;
  nickname: string;
  /** This client's relay id, once the welcome arrives. */
  selfId: string | null;
  peers: RoomPeerState[];
  error: string | null;
}

export const EMPTY_ROOM: RoomState = {
  phase: 'offline',
  mode: null,
  roomId: null,
  base: null,
  nickname: DEFAULT_NICKNAME,
  selfId: null,
  peers: [],
  error: null,
};

/** WebSocket URL for a room on a relay base (`http(s)://host` or `ws(s)://host`). */
export function roomSocketUrl(options: { base: string; roomId: string; token?: string }): string {
  const base = options.base.trim() || 'http://localhost:8080';
  const withProtocol = base.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:').replace(/^ws:/, 'ws:').replace(/^wss:/, 'wss:');
  const url = new URL(withProtocol.includes('://') ? withProtocol : `ws://${withProtocol}`);
  url.pathname = '/collab';
  url.searchParams.set('room', options.roomId.trim() || 'default');
  if (options.token && options.token.trim() !== '') url.searchParams.set('token', options.token.trim());
  return url.toString();
}

/** Relay base implied by the page: the same origin, so a self-hosted build just works. */
export function defaultRelayBase(location: { protocol: string; host: string }): string {
  return `${location.protocol === 'https:' ? 'https' : 'http'}://${location.host}`;
}

function toPeer(peer: Peer): RoomPeerState {
  return {
    clientId: peer.clientId,
    nickname: normalizeNickname(peer.nickname),
    color: peer.color || deriveColor(peer.clientId),
    cursor: peer.cursor ?? null,
    selection: peer.selection ?? [],
    viewport: null,
  };
}

/** Pure reducer: apply one server message to the room state. */
export function applyServerMessage(state: RoomState, message: ServerMessage): RoomState {
  switch (message.t) {
    case 'welcome':
      return {
        ...state,
        phase: 'online',
        error: null,
        roomId: message.room,
        base: state.base,
        // The relay reports the room's mode; the client's own key is the source
        // of truth for decryption, this is what the UI labels.
        mode: message.e2e ? 'e2e' : 'plaintext',
        selfId: message.self.clientId,
        nickname: normalizeNickname(message.self.nickname),
        peers: message.peers.map(toPeer).filter((peer) => peer.clientId !== message.self.clientId),
      };
    case 'peer-join': {
      if (message.peer.clientId === state.selfId) return state;
      const others = state.peers.filter((peer) => peer.clientId !== message.peer.clientId);
      return { ...state, peers: [...others, toPeer(message.peer)] };
    }
    case 'peer-leave':
      return { ...state, peers: state.peers.filter((peer) => peer.clientId !== message.clientId) };
    case 'cursor':
      return {
        ...state,
        peers: state.peers.map((peer) =>
          peer.clientId === message.clientId ? { ...peer, cursor: { x: message.x, y: message.y } } : peer,
        ),
      };
    case 'viewport':
      return {
        ...state,
        peers: state.peers.map((peer) =>
          peer.clientId === message.clientId ? { ...peer, viewport: { x: message.x, y: message.y, zoom: message.zoom } } : peer,
        ),
      };
    case 'selection':
      return {
        ...state,
        peers: state.peers.map((peer) => (peer.clientId === message.clientId ? { ...peer, selection: message.ids } : peer)),
      };
    case 'error':
      return { ...state, phase: 'error', error: message.message };
    default:
      // snapshots/ops/pong: presence-only client, nothing to apply.
      return state;
  }
}

/**
 * Viewport that follows a peer: their cursor is centred, keeping the zoom the
 * viewer already had. The relay carries cursors and selections, not viewports,
 * so following is "keep their pointer centred"; when the peer has a selection
 * the caller can frame it instead (`frameBounds`).
 */
export function followCursorViewport(
  cursor: Cursor,
  size: { width: number; height: number },
  viewport: Viewport,
): Viewport {
  const zoom = viewport.zoom;
  return {
    zoom,
    x: size.width / 2 - cursor.x * zoom,
    y: size.height / 2 - cursor.y * zoom,
  };
}

/** Viewport that frames a scene-space box, centred and clamped to sane zoom. */
export function frameBoundsViewport(
  box: { x: number; y: number; width: number; height: number },
  size: { width: number; height: number },
  options: { padding?: number; maxZoom?: number; minZoom?: number } = {},
): Viewport {
  const padding = options.padding ?? 80;
  const width = Math.max(1, box.width);
  const height = Math.max(1, box.height);
  const zoom = Math.min(
    options.maxZoom ?? 4,
    Math.max(options.minZoom ?? 0.05, Math.min((size.width - padding) / width, (size.height - padding) / height)),
  );
  return {
    zoom,
    x: size.width / 2 - (box.x + width / 2) * zoom,
    y: size.height / 2 - (box.y + height / 2) * zoom,
  };
}

/** Short label for an avatar chip. */
export function initialsOf(nickname: string): string {
  const parts = normalizeNickname(nickname).split(' ').filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const second = parts.length > 1 ? parts[parts.length - 1]![0] : '';
  return `${first}${second ?? ''}`.toUpperCase();
}

export interface RoomClient {
  /**
   * Join a room. `key` is the room key from the share link's fragment; without it
   * the join is refused unless `allowPlaintext` is set, and then the state is
   * labelled `plaintext` so the UI can say so.
   */
  connect(options: {
    base: string;
    roomId: string;
    token?: string;
    nickname: string;
    clientId: string;
    key?: string;
    allowPlaintext?: boolean;
  }): void;
  disconnect(): void;
  sendCursor(cursor: Cursor | null): void;
  /** Share this client's viewport, so a peer can follow it. */
  sendViewport(viewport: { x: number; y: number; zoom: number }): void;
  sendSelection(ids: string[]): void;
  /** Send this client's edits, stamped by the relay when it relays them. Encrypted in an E2E room. */
  sendOps(ops: unknown, seq?: number): Promise<void>;
  /** Publish the whole document as the room's snapshot. Encrypted in an E2E room. */
  sendSnapshot(file: unknown, seq: number): Promise<void>;
  readonly connected: boolean;
}

export interface RoomClientHandlers {
  onState: (state: RoomState) => void;
  onCursor: (clientId: string, cursor: Cursor) => void;
  /** A peer's viewport (presence): used by follow mode. */
  onViewport?: (clientId: string, viewport: { x: number; y: number; zoom: number }) => void;
  /** A remote batch of edits, already stamped by the relay (M13 convergence). */
  onOps?: (batch: { seq: number; clientId: string; ops: unknown }) => void;
  /** The room's last snapshot, offered on join. */
  onSnapshot?: (snapshot: { file: unknown; seq: number; clientId: string | null }) => void;
}

/**
 * Thin WebSocket client: encodes the protocol, reports every server message to
 * the reducer, and never throws at the caller (a room is an enhancement).
 */
export function createRoomClient(handlers: RoomClientHandlers, createSocket?: (url: string) => WebSocket): RoomClient {
  let socket: WebSocket | null = null;
  let state: RoomState = EMPTY_ROOM;
  let clientId = '';
  /** Derived AES-GCM key for this room, once a key was supplied. */
  let docKey: Promise<CryptoKey> | null = null;
  let roomId = '';
  /**
   * Generation of the current connection. Every `connect`/`disconnect` bumps it,
   * and a socket's handlers ignore themselves once their generation is stale —
   * a closed socket's asynchronous `onclose` must never write `offline` over the
   * state of a room joined afterwards.
   */
  let generation = 0;

  const emit = (next: RoomState) => {
    state = next;
    handlers.onState(next);
  };

  const send = (message: ClientMessage) => {
    if (!socket || socket.readyState !== 1) return;
    socket.send(JSON.stringify(message));
  };

  /**
   * Hand a document payload to the caller, decrypting it first when the room is
   * encrypted. A payload that will not decrypt (wrong key, tampered ciphertext,
   * or a ciphertext from another room) is reported rather than applied.
   */
  const deliver = (epoch: number, kind: 'ops' | 'snapshot', payload: unknown, apply: (value: unknown) => void): void => {
    const key = docKey;
    if (!key) {
      apply(payload);
      return;
    }
    void key
      .then((resolved) => decryptPayload(resolved, roomId, kind, payload))
      .then((result) => {
        if (epoch !== generation) return;
        if (result.ok) apply(result.value);
        else emit({ ...state, phase: 'error', error: `Could not decrypt a room ${kind === 'ops' ? 'update' : 'snapshot'} (${result.reason})` });
      });
  };

  return {
    get connected() {
      return state.phase === 'online';
    },
    connect(options) {
      // A new connection supersedes any previous one: bump the generation so the
      // old socket's handlers go inert, then hang it up.
      generation += 1;
      const epoch = generation;
      const previous = socket;
      socket = null;
      if (previous) {
        previous.onopen = null;
        previous.onmessage = null;
        previous.onerror = null;
        previous.onclose = null;
        try {
          previous.close();
        } catch {
          // already closed
        }
      }

      const typedKey = options.key?.trim() ?? '';
      const rawKey = typedKey === '' ? null : decodeRoomKey(typedKey);
      if (typedKey !== '' && rawKey === null) {
        // A key that is present but unreadable is an error, never "no key":
        // joining plaintext here would silently ignore what the user typed.
        emit({
          ...EMPTY_ROOM,
          phase: 'error',
          roomId: options.roomId,
          base: options.base,
          mode: null,
          error: 'That key is not a valid room key. Paste the whole share link, or clear the field to join in plaintext.',
        });
        return;
      }
      if (!rawKey && !options.allowPlaintext) {
        // Never join silently in plaintext: that is the whole point of the key
        // living in the fragment.
        emit({
          ...EMPTY_ROOM,
          phase: 'error',
          roomId: options.roomId,
          base: options.base,
          mode: null,
          error: 'This room is encrypted. Open the share link (its key is in the URL fragment) or join in plaintext mode explicitly.',
        });
        return;
      }

      clientId = options.clientId;
      roomId = options.roomId;
      docKey = rawKey ? deriveRoomKey(rawKey, options.roomId, 'doc') : null;
      const nickname = normalizeNickname(options.nickname);
      emit({
        ...EMPTY_ROOM,
        phase: 'connecting',
        roomId: options.roomId,
        base: options.base,
        mode: rawKey ? 'e2e' : 'plaintext',
        nickname,
      });
      const url = roomSocketUrl({ base: options.base, roomId: options.roomId, ...(options.token ? { token: options.token } : {}) });
      let opened: WebSocket;
      try {
        const open = createSocket ?? ((target: string) => new WebSocket(target));
        opened = open(url);
      } catch (error) {
        emit({ ...state, phase: 'error', error: error instanceof Error ? error.message : String(error) });
        return;
      }
      socket = opened;
      const e2e = rawKey !== null;
      opened.onopen = () => {
        if (epoch !== generation) return;
        send({ t: 'hello', clientId, nickname, e2e });
      };
      opened.onmessage = (event: MessageEvent<string>) => {
        if (epoch !== generation) return;
        let parsed: ServerMessage;
        try {
          parsed = JSON.parse(String(event.data)) as ServerMessage;
        } catch {
          return;
        }
        emit(applyServerMessage(state, parsed));
        if (parsed.t === 'cursor') handlers.onCursor(parsed.clientId, { x: parsed.x, y: parsed.y });
        if (parsed.t === 'viewport' && handlers.onViewport) {
          handlers.onViewport(parsed.clientId, { x: parsed.x, y: parsed.y, zoom: parsed.zoom });
        }
        if (parsed.t === 'ops' && handlers.onOps) {
          deliver(epoch, 'ops', parsed.ops, (ops) => handlers.onOps!({ seq: parsed.seq, clientId: parsed.clientId, ops }));
        }
        if (parsed.t === 'snapshot' && handlers.onSnapshot && parsed.file !== null) {
          deliver(epoch, 'snapshot', parsed.file, (file) => handlers.onSnapshot!({ file, seq: parsed.seq, clientId: parsed.clientId }));
        }
        if (parsed.t === 'welcome' && parsed.snapshot && handlers.onSnapshot) {
          deliver(epoch, 'snapshot', parsed.snapshot.file, (file) =>
            handlers.onSnapshot!({ file, seq: parsed.snapshot!.seq, clientId: null }),
          );
        }
      };
      opened.onerror = () => {
        if (epoch !== generation) return;
        emit({ ...state, phase: 'error', error: 'Could not reach the relay' });
      };
      opened.onclose = () => {
        if (epoch !== generation) return;
        socket = null;
        emit(state.phase === 'error' ? state : { ...state, phase: 'offline', peers: [], selfId: null });
      };
    },
    disconnect() {
      // Bumping the generation makes the closed socket's handlers inert, so its
      // asynchronous close event cannot overwrite a later room's state.
      generation += 1;
      const closing = socket;
      socket = null;
      if (closing) {
        closing.onopen = null;
        closing.onmessage = null;
        closing.onerror = null;
        closing.onclose = null;
        try {
          closing.close();
        } catch {
          // already closed
        }
      }
      emit({ ...EMPTY_ROOM, nickname: state.nickname });
    },
    sendCursor(cursor) {
      if (cursor) send({ t: 'cursor', x: cursor.x, y: cursor.y });
    },
    sendViewport(viewport) {
      send({ t: 'viewport', x: viewport.x, y: viewport.y, zoom: viewport.zoom });
    },
    sendSelection(ids) {
      send({ t: 'selection', ids });
    },
    async sendOps(ops, seq) {
      if (Array.isArray(ops) && ops.length === 0) return;
      // In an E2E room the relay only ever receives the envelope; the room id is
      // bound into the tag, so a ciphertext cannot be replayed into another room.
      const payload = docKey ? await encryptPayload(await docKey, roomId, 'ops', ops) : ops;
      send({ t: 'ops', ops: payload, ...(seq === undefined ? {} : { seq }) });
    },
    async sendSnapshot(file, seq) {
      const payload = docKey ? await encryptPayload(await docKey, roomId, 'snapshot', file) : file;
      send({ t: 'snapshot', file: payload, seq });
    },
  };
}
