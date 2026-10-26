import { nextNodeId } from '../model/ids';
import { useEditor, type EditorState } from './editorStore';

/**
 * Local multi-tab presence (M13, deliberately scoped).
 *
 * Tabs of the same browser profile that share this origin exchange cursor and
 * selection state over a `BroadcastChannel`. That is *local only*: there is no
 * server, no account and no cross-machine sync — real-time collaboration with
 * other people still needs a backend and is not implemented. The transport is
 * isolated behind this module so a future server transport can replace it
 * without touching the canvas or the store.
 */

export const PEER_TTL_MS = 8_000;
export const PRESENCE_CHANNEL = 'pigma:presence';
const BROADCAST_INTERVAL_MS = 60;

export interface PresenceCursor {
  /** World coordinates on the peer's active page. */
  x: number;
  y: number;
}

export interface PresencePeer {
  id: string;
  name: string;
  color: string;
  pageId: string;
  selection: string[];
  cursor: PresenceCursor | null;
  /** Local clock of the last update; used to drop tabs that went away. */
  updatedAt: number;
}

/** Cursor colours, picked deterministically from the peer id. */
export const PEER_COLORS = ['#f24822', '#0d99ff', '#14ae5c', '#9747ff', '#ff8a00', '#ff24bd'] as const;

export function peerColor(id: string): string {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) % 100_000;
  return PEER_COLORS[hash % PEER_COLORS.length]!;
}

/** Friendly, stable name for a peer ("Tab a1b2"). */
export function peerName(id: string): string {
  return `Tab ${id.slice(0, 4)}`;
}

export type PresenceWireMessage =
  | { type: 'presence'; peer: Omit<PresencePeer, 'updatedAt'>; sentAt: number }
  | { type: 'leave'; id: string };

export function encodePresence(message: PresenceWireMessage): string {
  return JSON.stringify(message);
}

/** Tolerant decode: anything malformed is ignored rather than thrown. */
export function decodePresence(raw: unknown): PresenceWireMessage | null {
  if (typeof raw !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as Record<string, unknown>;
  if (record.type === 'leave') {
    return typeof record.id === 'string' ? { type: 'leave', id: record.id } : null;
  }
  if (record.type !== 'presence' || !record.peer || typeof record.peer !== 'object') return null;
  const peer = record.peer as Record<string, unknown>;
  if (typeof peer.id !== 'string' || peer.id === '') return null;
  if (typeof peer.pageId !== 'string') return null;
  const cursor =
    peer.cursor && typeof peer.cursor === 'object' && Number.isFinite((peer.cursor as PresenceCursor).x) && Number.isFinite((peer.cursor as PresenceCursor).y)
      ? { x: (peer.cursor as PresenceCursor).x, y: (peer.cursor as PresenceCursor).y }
      : null;
  return {
    type: 'presence',
    sentAt: typeof record.sentAt === 'number' ? record.sentAt : 0,
    peer: {
      id: peer.id,
      name: typeof peer.name === 'string' && peer.name !== '' ? peer.name : peerName(peer.id),
      color: typeof peer.color === 'string' && peer.color !== '' ? peer.color : peerColor(peer.id),
      pageId: peer.pageId,
      selection: Array.isArray(peer.selection) ? peer.selection.filter((id): id is string => typeof id === 'string') : [],
      cursor,
    },
  };
}

/** Insert or replace a peer, newest last, ignoring our own id. */
export function mergePeer(
  peers: PresencePeer[],
  incoming: PresencePeer,
  now: number,
  selfId?: string,
): PresencePeer[] {
  if (incoming.id === selfId) return peers;
  const stamped: PresencePeer = { ...incoming, updatedAt: now };
  const without = peers.filter((peer) => peer.id !== incoming.id);
  return [...without, stamped];
}

/** Drop peers that stopped broadcasting (closed tab, crashed renderer). */
export function prunePeers(peers: PresencePeer[], now: number, ttl = PEER_TTL_MS): PresencePeer[] {
  const alive = peers.filter((peer) => now - peer.updatedAt < ttl);
  return alive.length === peers.length ? peers : alive;
}

/** Everything this tab advertises to its siblings. */
export function localPeerSnapshot(state: EditorState, id: string, name: string, color: string): Omit<PresencePeer, 'updatedAt'> {
  return {
    id,
    name,
    color,
    pageId: state.pageId,
    selection: state.selection,
    cursor: state.localCursor,
  };
}

/** True when a peer should be drawn on the page the local user is looking at. */
export function peerVisibleOnPage(peer: PresencePeer, pageId: string): boolean {
  return peer.pageId === pageId;
}

/**
 * Wire this tab into the local presence channel. Returns a detach function that
 * also announces the tab leaving.
 */
export function attachPresence(): () => void {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return () => {};
  const id = nextNodeId();
  const name = peerName(id);
  const color = peerColor(id);
  const channel = new BroadcastChannel(PRESENCE_CHANNEL);
  let lastBroadcast = 0;
  let pending: number | null = null;

  const announce = () => {
    lastBroadcast = Date.now();
    const state = useEditor.getState();
    channel.postMessage(encodePresence({ type: 'presence', peer: localPeerSnapshot(state, id, name, color), sentAt: lastBroadcast }));
  };

  const schedule = () => {
    if (pending !== null) return;
    pending = window.setTimeout(() => {
      pending = null;
      announce();
    }, BROADCAST_INTERVAL_MS);
  };

  const unsubscribe = useEditor.subscribe((state, previous) => {
    if (
      state.selection !== previous.selection ||
      state.pageId !== previous.pageId ||
      state.localCursor !== previous.localCursor
    ) {
      schedule();
    }
  });

  channel.onmessage = (event: MessageEvent<unknown>) => {
    const message = decodePresence(event.data);
    if (!message) return;
    const now = Date.now();
    const state = useEditor.getState();
    if (message.type === 'leave') {
      useEditor.setState({ presence: state.presence.filter((peer) => peer.id !== message.id) });
      return;
    }
    useEditor.setState({
      presence: prunePeers(mergePeer(state.presence, { ...message.peer, updatedAt: now }, now, id), now),
    });
    // Answer a new sibling so it sees us immediately.
    if (now - lastBroadcast > BROADCAST_INTERVAL_MS) announce();
  };

  const sweep = window.setInterval(() => {
    const state = useEditor.getState();
    const alive = prunePeers(state.presence, Date.now());
    if (alive !== state.presence) useEditor.setState({ presence: alive });
  }, PEER_TTL_MS / 2);

  /** Announce the tab leaving, both on unload and on detach. */
  const leave = () => channel.postMessage(encodePresence({ type: 'leave', id }));

  announce();
  window.addEventListener('beforeunload', leave);

  return () => {
    window.removeEventListener('beforeunload', leave);
    window.clearInterval(sweep);
    if (pending !== null) window.clearTimeout(pending);
    leave();
    unsubscribe();
    channel.close();
  };
}
