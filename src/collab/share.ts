import { buildRoomLink, decodeRoomKey, encodeRoomKey, generateRoomKey, parseRoomLink } from './crypto';

/**
 * Room invites (M13).
 *
 * A share link is this app's URL with the room and its key in the **fragment**:
 * the fragment is never sent to a server, so the relay (or anyone watching the
 * connection) never sees the key, and the document payloads it relays stay
 * unreadable to it. The key is deliberately kept out of the query string, out of
 * every log, and out of the editor store: it exists in the link, in the panel
 * field while the user is looking at it, and inside the room client.
 */

export interface RoomInvite {
  roomId: string;
  /** Raw 32-byte room key, decoded from the link. */
  key: Uint8Array;
  /** Relay the link was created against, when the inviter pinned one. */
  relay?: string;
}

export interface ShareLinkOptions {
  /** App origin the link points at (e.g. `https://getpigma.com`). */
  base: string;
  roomId: string;
  key: Uint8Array;
  /** Relay to pin, so a self-hosted link carries its own endpoint. */
  relay?: string;
}

/**
 * Build the shareable link. `buildRoomLink` owns the fragment format
 * (`#room=…&key=…`); an overridden relay is appended to the same fragment so a
 * self-hosted invite works without a second copy/paste.
 */
export function buildShareLink(options: ShareLinkOptions): string {
  const link = buildRoomLink(options.base, options.roomId, options.key);
  if (!options.relay || options.relay.trim() === '') return link;
  return `${link}&relay=${encodeURIComponent(options.relay.trim())}`;
}

/** Read an invite out of a fragment (`#room=…&key=…[&relay=…]`) or a full URL. */
export function readRoomInvite(input: string): RoomInvite | null {
  const parsed = parseRoomLink(input);
  if (!parsed) return null;
  const hash = input.includes('#') ? input.slice(input.indexOf('#') + 1) : input;
  const relay = new URLSearchParams(hash).get('relay');
  return {
    roomId: parsed.roomId,
    key: parsed.key,
    ...(relay && relay.trim() !== '' ? { relay: relay.trim() } : {}),
  };
}

/** A fresh invite for a room: a new key, and the link that carries it. */
export function createInvite(options: { base: string; roomId: string; relay?: string }): {
  invite: RoomInvite;
  link: string;
  /** Fragment-safe key text, for a "copy key only" affordance. */
  keyText: string;
} {
  const key = generateRoomKey();
  return {
    invite: { roomId: options.roomId, key, ...(options.relay ? { relay: options.relay } : {}) },
    link: buildShareLink({ base: options.base, roomId: options.roomId, key, ...(options.relay ? { relay: options.relay } : {}) }),
    keyText: encodeRoomKey(key),
  };
}

/** The invite carried by a link, as the join form needs it (key kept as text). */
export function inviteKeyText(invite: RoomInvite): string {
  return encodeRoomKey(invite.key);
}

/** Parse key text typed or pasted by a user. Returns null when it is not a key. */
export function parseKeyText(text: string): Uint8Array | null {
  return decodeRoomKey(text.trim());
}

/** Human label for a room's mode, used by the panel and the toolbar. */
export function modeLabel(mode: 'e2e' | 'plaintext' | null): string {
  if (mode === 'e2e') return 'End-to-end encrypted';
  if (mode === 'plaintext') return 'Plaintext — the relay can read this room';
  return 'Not connected';
}
