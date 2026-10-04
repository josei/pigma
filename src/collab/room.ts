/**
 * Room state for the collaboration relay.
 *
 * A room is: the participants currently connected, the last snapshot a client
 * sent, and a monotonic sequence number. Nothing is written to disk here and
 * nothing about a participant outlives their connection — the room holds a
 * nickname only to echo it to other clients for cursor labels.
 *
 * Environment-agnostic (no Node imports), so it is driven identically by the
 * WebSocket server and by tests.
 */
import { isEncryptedEnvelope } from './crypto';
import {
  COLLAB_PROTOCOL_VERSION,
  deriveColor,
  type ClientMessage,
  type Cursor,
  type Peer,
  type ServerMessage,
} from './protocol';

/** Delivers a message to one participant. Injected so the room owns no transport. */
export type SendTo = (clientId: string, message: ServerMessage) => void;

export interface Snapshot {
  file: unknown;
  seq: number;
}

interface Participant extends Peer {
  connectedAt: number;
  /** Declared at join; the room's mode must match. */
  e2e: boolean;
}

/**
 * Something the room refused. The server turns this into an error message and a
 * close, so the policy is enforced by the relay rather than trusted to clients.
 */
export interface RoomViolation {
  code: string;
  message: string;
}

/**
 * One document room. `id` is the document id from the URL; the relay treats it
 * as an opaque label.
 */
export class Room {
  readonly id: string;
  private readonly participants = new Map<string, Participant>();
  private snapshot: Snapshot | null = null;
  private sequence = 0;
  private readonly send: SendTo;
  private readonly now: () => number;
  private lastActivity: number;
  /** Room mode, fixed by the first participant. `null` until someone joins. */
  private e2eMode: boolean | null = null;

  constructor(id: string, send: SendTo, options: { now?: () => number; snapshot?: Snapshot | null } = {}) {
    this.id = id;
    this.send = send;
    this.now = options.now ?? Date.now;
    this.snapshot = options.snapshot ?? null;
    this.sequence = this.snapshot?.seq ?? 0;
    this.lastActivity = this.now();
  }

  /** When this room last saw a join, a message, or a snapshot. */
  get lastActivityAt(): number {
    return this.lastActivity;
  }

  /** Mark activity; the sweep uses this to find idle rooms. */
  touch(): void {
    this.lastActivity = this.now();
  }

  /** Participants currently connected. Presence only; never persisted. */
  peers(): Peer[] {
    return [...this.participants.values()].map(({ connectedAt: _connectedAt, ...peer }) => peer);
  }

  lastSnapshot(): Snapshot | null {
    return this.snapshot;
  }

  seq(): number {
    return this.sequence;
  }

  has(clientId: string): boolean {
    return this.participants.has(clientId);
  }

  get peerCount(): number {
    return this.participants.size;
  }

  /**
   * Add a participant and tell everyone. The joiner gets the peer list and the
   * last snapshot so it converges with what it missed; existing peers get a
   * `peer-join`. A reconnecting clientId replaces the previous entry (the old
   * socket is dropped by the server before this is called).
   */
  /** Whether this room's document payloads are end-to-end encrypted. */
  get e2e(): boolean {
    return this.e2eMode ?? false;
  }

  join(clientId: string, nickname: string, e2e = false): RoomViolation | null {
    this.touch();
    if (this.e2eMode === null) this.e2eMode = e2e;
    else if (this.e2eMode !== e2e) {
      // A plaintext client must not slip into an encrypted room (or the reverse):
      // that is the difference between a claim and a guarantee.
      return {
        code: 'mode-mismatch',
        message: this.e2eMode
          ? 'this room is end-to-end encrypted; join with its key'
          : 'this room is in plaintext mode; an encrypted client cannot join it',
      };
    }
    const peer: Participant = {
      clientId,
      nickname,
      color: deriveColor(clientId),
      cursor: null,
      selection: [],
      connectedAt: this.now(),
      e2e,
    };
    const existing = this.participants.get(clientId);
    if (existing) {
      // Same id reconnecting: replace in place, no join/leave churn for peers.
      this.participants.set(clientId, { ...peer, cursor: existing.cursor, selection: existing.selection });
      return null;
    }
    const welcome: ServerMessage = {
      t: 'welcome',
      protocol: COLLAB_PROTOCOL_VERSION,
      room: this.id,
      e2e: this.e2e,
      self: strip(peer),
      peers: this.peers(),
      seq: this.sequence,
      snapshot: this.snapshot,
    };
    this.send(clientId, welcome);
    this.participants.set(clientId, peer);
    for (const other of this.participants.keys()) {
      if (other !== clientId) this.send(other, { t: 'peer-join', peer: strip(peer) });
    }
    return null;
  }

  /** Remove a participant and tell the rest. Idempotent. */
  leave(clientId: string): void {
    if (!this.participants.delete(clientId)) return;
    for (const other of this.participants.keys()) this.send(other, { t: 'peer-leave', clientId });
  }

  /**
   * Handle one decoded client message. Presence updates are relayed with the
   * sender's nickname/colour attached (that is what cursor labels use); ops are
   * relayed verbatim under a fresh sequence number; snapshots replace the
   * room's last snapshot.
   */
  handle(clientId: string, message: ClientMessage): RoomViolation | null {
    const participant = this.participants.get(clientId);
    if (!participant) return null;
    this.touch();

    switch (message.t) {
      case 'cursor': {
        const cursor: Cursor = { x: message.x, y: message.y };
        participant.cursor = cursor;
        this.broadcast(clientId, {
          t: 'cursor',
          clientId,
          nickname: participant.nickname,
          color: participant.color,
          x: cursor.x,
          y: cursor.y,
        });
        return null;
      }
      case 'viewport': {
        // Presence, like the cursor: it lets a peer follow this viewport without
        // touching the document.
        this.broadcast(clientId, { t: 'viewport', clientId, x: message.x, y: message.y, zoom: message.zoom });
        return null;
      }
      case 'selection': {
        participant.selection = message.ids;
        this.broadcast(clientId, {
          t: 'selection',
          clientId,
          nickname: participant.nickname,
          color: participant.color,
          ids: message.ids,
        });
        return null;
      }
      case 'ops': {
        if (this.e2e && !isEncryptedEnvelope(message.ops)) {
          // In an encrypted room the relay stores and forwards ciphertext or
          // nothing at all.
          return { code: 'plaintext-rejected', message: 'this room is end-to-end encrypted; ops must be ciphertext' };
        }
        this.sequence += 1;
        this.broadcast(clientId, { t: 'ops', clientId, ops: message.ops, seq: this.sequence });
        return null;
      }
      case 'snapshot': {
        if (this.e2e && !isEncryptedEnvelope(message.file)) {
          return { code: 'plaintext-rejected', message: 'this room is end-to-end encrypted; the snapshot must be ciphertext' };
        }
        // Last-writer-wins: the server does not interpret the document, it
        // stores the most recent snapshot a client sent (an envelope under E2E).
        this.snapshot = { file: message.file, seq: message.seq };
        this.sequence = Math.max(this.sequence, message.seq);
        this.broadcast(clientId, { t: 'snapshot', clientId, file: message.file, seq: message.seq });
        return null;
      }
      case 'ping':
        this.send(clientId, { t: 'pong' });
        return null;
      case 'hello':
        // The server performs the join (it owns the socket); a late hello is ignored.
        return null;
    }
  }

  /** Send to every participant except the sender. */
  private broadcast(senderId: string, message: ServerMessage): void {
    for (const clientId of this.participants.keys()) {
      if (clientId !== senderId) this.send(clientId, message);
    }
  }
}

function strip(participant: Participant): Peer {
  return {
    clientId: participant.clientId,
    nickname: participant.nickname,
    color: participant.color,
    cursor: participant.cursor,
    selection: participant.selection,
  };
}

/**
 * Rooms by id. Created on first join and kept until the server stops (a room
 * holds only its snapshot, which is persisted by the server on change).
 */
export class RoomRegistry {
  private readonly rooms = new Map<string, Room>();
  private readonly send: SendTo;
  private readonly now: () => number;
  private readonly load: ((roomId: string) => Snapshot | null) | undefined;

  constructor(send: SendTo, options: { now?: () => number; load?: (roomId: string) => Snapshot | null } = {}) {
    this.send = send;
    this.now = options.now ?? Date.now;
    this.load = options.load;
  }

  get(roomId: string): Room {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = new Room(roomId, this.send, { now: this.now, snapshot: this.load?.(roomId) ?? null });
      this.rooms.set(roomId, room);
    }
    return room;
  }

  has(roomId: string): boolean {
    return this.rooms.has(roomId);
  }

  ids(): string[] {
    return [...this.rooms.keys()];
  }

  get size(): number {
    return this.rooms.size;
  }

  /** Drop a room that has no participants and nothing worth keeping. */
  prune(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (room && room.peerCount === 0 && room.lastSnapshot() === null) this.rooms.delete(roomId);
  }

  /**
   * Garbage-collect: drop rooms that have been empty and idle for `ttlMs`.
   * Returns the room ids that were dropped, so the caller can expire their
   * snapshots too.
   */
  sweep(ttlMs: number, now: number = Date.now()): string[] {
    const dropped: string[] = [];
    for (const [roomId, room] of this.rooms) {
      if (room.peerCount > 0) continue;
      if (now - room.lastActivityAt < ttlMs) continue;
      this.rooms.delete(roomId);
      dropped.push(roomId);
    }
    return dropped;
  }
}
