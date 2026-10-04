import { describe, expect, it } from 'vitest';
import {
  PEER_COLORS,
  PEER_TTL_MS,
  decodePresence,
  encodePresence,
  localPeerSnapshot,
  mergePeer,
  peerColor,
  peerName,
  peerVisibleOnPage,
  prunePeers,
  type PresencePeer,
} from './presence';
import { useEditor } from './editorStore';

function peer(overrides: Partial<PresencePeer> = {}): PresencePeer {
  return {
    id: 'peer-1',
    name: 'Tab aaaa',
    color: '#f24822',
    pageId: 'page-1',
    selection: ['n1'],
    cursor: { x: 10, y: 20 },
    updatedAt: 1000,
    ...overrides,
  };
}

describe('local presence', () => {
  it('assigns a stable colour and name per peer id', () => {
    expect(peerColor('abc')).toBe(peerColor('abc'));
    expect(PEER_COLORS).toContain(peerColor('abc') as (typeof PEER_COLORS)[number]);
    expect(peerName('deadbeef')).toBe('Tab dead');
    // Different ids land on the palette without throwing.
    for (const id of ['a', 'bb', 'ccc', 'dddd', 'eeeee', 'ffffff']) {
      expect(PEER_COLORS).toContain(peerColor(id) as (typeof PEER_COLORS)[number]);
    }
  });

  it('round-trips a presence message', () => {
    const message = { type: 'presence' as const, peer: peer(), sentAt: 123 };
    const decoded = decodePresence(encodePresence(message));
    expect(decoded).toMatchObject({ type: 'presence', sentAt: 123 });
    expect(decoded && decoded.type === 'presence' ? decoded.peer.selection : null).toEqual(['n1']);
    expect(decoded && decoded.type === 'presence' ? decoded.peer.cursor : null).toEqual({ x: 10, y: 20 });
  });

  it('ignores malformed messages instead of throwing', () => {
    expect(decodePresence('not json')).toBeNull();
    expect(decodePresence('null')).toBeNull();
    expect(decodePresence('[]')).toBeNull();
    expect(decodePresence('{"type":"presence"}')).toBeNull();
    expect(decodePresence('{"type":"presence","peer":{"id":""}}')).toBeNull();
    expect(decodePresence('{"type":"leave"}')).toBeNull();
    expect(decodePresence(42)).toBeNull();
    expect(decodePresence('{"type":"leave","id":"x"}')).toEqual({ type: 'leave', id: 'x' });
  });

  it('fills in defaults for a partial peer payload', () => {
    const decoded = decodePresence('{"type":"presence","peer":{"id":"zzzz","pageId":"p"}}');
    expect(decoded).toMatchObject({ type: 'presence' });
    if (decoded?.type !== 'presence') throw new Error('expected a presence message');
    expect(decoded.peer.name).toBe('Tab zzzz');
    expect(PEER_COLORS).toContain(decoded.peer.color as (typeof PEER_COLORS)[number]);
    expect(decoded.peer.selection).toEqual([]);
    expect(decoded.peer.cursor).toBeNull();
  });

  it('upserts peers, ignores itself and drops stale tabs', () => {
    const merged = mergePeer([peer()], peer({ cursor: { x: 99, y: 1 } }), 5000);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.cursor).toEqual({ x: 99, y: 1 });
    expect(merged[0]!.updatedAt).toBe(5000);

    const withSecond = mergePeer(merged, peer({ id: 'peer-2' }), 5000);
    expect(withSecond.map((entry) => entry.id)).toEqual(['peer-1', 'peer-2']);
    // Our own broadcast never becomes a peer.
    expect(mergePeer(withSecond, peer({ id: 'peer-2' }), 5000, 'peer-2')).toHaveLength(2);

    expect(prunePeers(withSecond, 5000 + PEER_TTL_MS - 1)).toHaveLength(2);
    const pruned = prunePeers(withSecond, 5000 + PEER_TTL_MS);
    expect(pruned).toEqual([]);
    // Pruning a live list returns the same array (no needless renders).
    expect(prunePeers(withSecond, 5001)).toBe(withSecond);
  });

  it('advertises this tab from the store and only shows peers on the same page', () => {
    useEditor.setState({ pageId: 'page-1', selection: ['n1'], localCursor: { x: 3, y: 4 } });
    const snapshot = localPeerSnapshot(useEditor.getState(), 'id-1', 'Tab id-1', '#0d99ff');
    expect(snapshot).toMatchObject({ id: 'id-1', pageId: 'page-1', selection: ['n1'], cursor: { x: 3, y: 4 } });

    expect(peerVisibleOnPage(peer(), 'page-1')).toBe(true);
    expect(peerVisibleOnPage(peer(), 'page-2')).toBe(false);
  });

  it('stores cursor updates without touching history', () => {
    const before = useEditor.getState().past.length;
    useEditor.getState().setLocalCursor({ x: 1, y: 2 });
    expect(useEditor.getState().localCursor).toEqual({ x: 1, y: 2 });
    // Identical positions are a no-op (the canvas fires move events constantly).
    const current = useEditor.getState().localCursor;
    useEditor.getState().setLocalCursor({ x: 1, y: 2 });
    expect(useEditor.getState().localCursor).toBe(current);
    useEditor.getState().setLocalCursor(null);
    expect(useEditor.getState().localCursor).toBeNull();
    expect(useEditor.getState().past.length).toBe(before);
  });
});
