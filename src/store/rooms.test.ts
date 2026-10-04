import { beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_ROOM, type RoomPeerState } from '../collab/client';
import { adoptRoomDocument, useEditor } from './editorStore';
import { emptyFile } from '../model/validate';

const peer = (clientId: string, patch: Partial<RoomPeerState> = {}): RoomPeerState => ({
  clientId,
  nickname: patch.nickname ?? 'Ada',
  color: patch.color ?? 'hsl(1, 65%, 55%)',
  cursor: patch.cursor ?? null,
  selection: patch.selection ?? [],
  viewport: patch.viewport ?? null,
});

const online = (peers: RoomPeerState[]) => ({
  ...EMPTY_ROOM,
  phase: 'online' as const,
  roomId: 'studio',
  selfId: 'me',
  mode: 'e2e' as const,
  peers,
});

beforeEach(() => {
  useEditor.setState({ room: { ...EMPTY_ROOM }, followingId: null, viewport: { x: 0, y: 0, zoom: 1 } });
});

describe('room join guard', () => {
  it('refuses a malformed key instead of joining plaintext', () => {
    useEditor.getState().joinRoom({ nickname: 'Ada', roomId: 'studio', base: 'http://relay', key: 'not-a-key', allowPlaintext: true });
    const room = useEditor.getState().room;
    expect(room.phase).toBe('error');
    expect(room.mode).toBeNull();
    expect(room.error).toMatch(/not a valid room key/i);
    // Nothing was opened: the document is untouched and no client exists.
    expect(useEditor.getState().room.peers).toEqual([]);
  });

  it('joins without a key only when plaintext is explicit', () => {
    useEditor.getState().joinRoom({ nickname: 'Ada', roomId: 'studio', base: 'http://relay' });
    expect(useEditor.getState().room.phase).toBe('error');
    expect(useEditor.getState().room.mode).toBeNull();
  });
});

describe('adopting the room document', () => {
  const roomFile = (id: string, name: string) => {
    const file = emptyFile(name);
    file.document.id = id;
    file.document.children[0]!.id = `${id}-page`;
    return file;
  };

  it('adopts a different room document for a tab with no local changes', () => {
    const local = roomFile('local', 'Mine');
    const room = roomFile('room', 'Theirs');
    const adopted = adoptRoomDocument(local, room, true);
    // Same document shape, the room's identity: node ids now line up, so peer
    // ops (matched by id) can apply.
    expect(adopted).not.toBeNull();
    expect(adopted!.document.id).toBe('room');
    expect(adopted!.document.children[0]!.id).toBe('room-page');
  });

  it('keeps local work and the same document', () => {
    const local = roomFile('local', 'Mine');
    // A tab that edited something keeps merging instead.
    expect(adoptRoomDocument(local, roomFile('room', 'Theirs'), false)).toBeNull();
    // The room's document already is this document: nothing to adopt.
    expect(adoptRoomDocument(local, roomFile('local', 'Same'), true)).toBeNull();
    // Garbage from the relay is never adopted.
    expect(adoptRoomDocument(local, { nope: true }, true)).toBeNull();
  });
});

describe('follow mode', () => {
  it('jumps to the peer viewport when they share one', () => {
    useEditor.setState({
      room: online([peer('other', { viewport: { x: -300, y: 120, zoom: 2 } })]),
      canvasSize: { width: 800, height: 600 },
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    useEditor.getState().followPeer('other');
    expect(useEditor.getState().followingId).toBe('other');
    expect(useEditor.getState().viewport).toEqual({ x: -300, y: 120, zoom: 2 });
  });

  it('falls back to centring on the peer cursor without a viewport', () => {
    useEditor.setState({
      room: online([peer('other', { cursor: { x: 100, y: 50 } })]),
      canvasSize: { width: 800, height: 600 },
      viewport: { x: 0, y: 0, zoom: 2 },
    });
    useEditor.getState().followPeer('other');
    expect(useEditor.getState().viewport).toEqual({ zoom: 2, x: 800 / 2 - 200, y: 600 / 2 - 100 });
  });

  it('stops following when asked for nobody', () => {
    useEditor.setState({ followingId: 'other' });
    useEditor.getState().followPeer(null);
    expect(useEditor.getState().followingId).toBeNull();
  });
});
