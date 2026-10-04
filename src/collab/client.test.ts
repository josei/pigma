import { describe, expect, it } from 'vitest';
import { encodeRoomKey, generateRoomKey } from './crypto';
import {
  EMPTY_ROOM,
  applyServerMessage,
  createRoomClient,
  type RoomState,
  defaultRelayBase,
  followCursorViewport,
  frameBoundsViewport,
  initialsOf,
  roomSocketUrl,
} from './client';
import { MAX_VIEW_COORD, decodeClientMessage, type ServerMessage } from './protocol';

/** Minimal fake WebSocket: the client only uses these members. */
class FakeSocket {
  readyState = 0;
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  fireOpen(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  fireMessage(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent<string>);
  }

  fireClose(): void {
    this.readyState = 3;
    this.onclose?.();
  }
}

const peer = (clientId: string, patch: Partial<ServerMessage & { nickname: string; color: string }> = {}) => ({
  clientId,
  nickname: patch.nickname ?? 'Ada',
  color: patch.color ?? 'hsl(1, 65%, 55%)',
  cursor: null,
  selection: [] as string[],
});

const welcome: ServerMessage = {
  t: 'welcome',
  protocol: 1,
  room: 'studio',
  e2e: false,
  self: peer('me', { nickname: 'Me' }),
  peers: [peer('other'), peer('me')],
  seq: 0,
  snapshot: null,
};

describe('rooms client', () => {
  it('builds a websocket url from any relay base', () => {
    expect(roomSocketUrl({ base: 'http://localhost:8080', roomId: 'studio' })).toBe('ws://localhost:8080/collab?room=studio');
    expect(roomSocketUrl({ base: 'https://getpigma.com', roomId: 'studio', token: 'secret' })).toBe(
      'wss://getpigma.com/collab?room=studio&token=secret',
    );
    expect(roomSocketUrl({ base: 'ws://127.0.0.1:9', roomId: '' })).toBe('ws://127.0.0.1:9/collab?room=default');
    expect(roomSocketUrl({ base: '   ', roomId: 'x' })).toContain('ws://localhost:8080/collab?room=x');
  });

  it('derives the relay base from the page origin', () => {
    expect(defaultRelayBase({ protocol: 'http:', host: '127.0.0.1:5173' })).toBe('http://127.0.0.1:5173');
    expect(defaultRelayBase({ protocol: 'https:', host: 'getpigma.com' })).toBe('https://getpigma.com');
  });

  it('welcomes the client with its own id and the other peers', () => {
    const state = applyServerMessage(EMPTY_ROOM, welcome);
    expect(state.phase).toBe('online');
    expect(state.roomId).toBe('studio');
    expect(state.selfId).toBe('me');
    // The relay the client connected to is kept for display.
    expect(state.base).toBeNull();
    // Our own entry is not a peer of ourselves.
    expect(state.peers.map((entry) => entry.clientId)).toEqual(['other']);
    expect(state.peers[0]!.nickname).toBe('Ada');
  });

  it('tracks joins, leaves, cursors and selections', () => {
    let state = applyServerMessage(EMPTY_ROOM, welcome);
    state = applyServerMessage(state, { t: 'peer-join', peer: peer('second', { nickname: 'Grace' }) });
    expect(state.peers.map((entry) => entry.nickname).sort()).toEqual(['Ada', 'Grace']);
    // A re-join replaces rather than duplicates.
    state = applyServerMessage(state, { t: 'peer-join', peer: peer('second', { nickname: 'Grace H' }) });
    expect(state.peers).toHaveLength(2);
    expect(state.peers.find((entry) => entry.clientId === 'second')!.nickname).toBe('Grace H');
    // Our own join echo is ignored.
    state = applyServerMessage(state, { t: 'peer-join', peer: peer('me') });
    expect(state.peers).toHaveLength(2);

    state = applyServerMessage(state, { t: 'cursor', clientId: 'other', nickname: 'Ada', color: 'hsl(1, 65%, 55%)', x: 12, y: 34 });
    expect(state.peers.find((entry) => entry.clientId === 'other')!.cursor).toEqual({ x: 12, y: 34 });
    state = applyServerMessage(state, { t: 'selection', clientId: 'other', nickname: 'Ada', color: 'hsl(1, 65%, 55%)', ids: ['n1', 'n2'] });
    expect(state.peers.find((entry) => entry.clientId === 'other')!.selection).toEqual(['n1', 'n2']);

    state = applyServerMessage(state, { t: 'peer-leave', clientId: 'other' });
    expect(state.peers.map((entry) => entry.clientId)).toEqual(['second']);
  });

  it('stores a peer viewport so follow mode can mirror it', () => {
    const state = applyServerMessage(EMPTY_ROOM, welcome);
    expect(state.peers[0]!.viewport).toBeNull();
    const withViewport = applyServerMessage(state, { t: 'viewport', clientId: 'other', x: -120, y: 40, zoom: 1.5 });
    expect(withViewport.peers[0]!.viewport).toEqual({ x: -120, y: 40, zoom: 1.5 });
    // Other peers are untouched.
    const two = applyServerMessage(withViewport, { t: 'peer-join', peer: peer('second') });
    expect(two.peers.find((entry) => entry.clientId === 'second')!.viewport).toBeNull();
    expect(two.peers.find((entry) => entry.clientId === 'other')!.viewport).toEqual({ x: -120, y: 40, zoom: 1.5 });
  });

  it('labels the join-time snapshot as the room\'s own, not a peer\'s', () => {
    // The store relies on this: only the snapshot offered on joining may be
    // adopted (a peer's later publish must not flip everyone's node ids).
    const sockets: FakeSocket[] = [];
    const snapshots: Array<{ clientId: string | null }> = [];
    const client = createRoomClient(
      {
        onState: () => undefined,
        onCursor: () => undefined,
        onSnapshot: (snapshot) => snapshots.push({ clientId: snapshot.clientId }),
      },
      () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
    );
    client.connect({ base: 'http://relay', roomId: 'r', nickname: 'Ada', clientId: 'me', allowPlaintext: true });
    const socket = sockets[0]!;
    socket.fireOpen();
    const file = { document: { id: 'room', children: [] } };
    socket.fireMessage({ t: 'welcome', protocol: 1, room: 'r', e2e: false, seq: 0,
      self: { clientId: 'me', nickname: 'Ada', color: '', cursor: null, selection: [] }, peers: [],
      snapshot: { file, seq: 3 } });
    socket.fireMessage({ t: 'snapshot', clientId: 'bob', file, seq: 4 });
    expect(snapshots).toEqual([{ clientId: null }, { clientId: 'bob' }]);
  });

  it('clamps a peer viewport to the documented view range', () => {
    // An extreme offset must not jerk a follower's view into the void.
    expect(decodeClientMessage(JSON.stringify({ t: 'viewport', x: 5e12, y: -5e12, zoom: 1 }))).toEqual({
      t: 'viewport',
      x: MAX_VIEW_COORD,
      y: -MAX_VIEW_COORD,
      zoom: 1,
    });
    expect(decodeClientMessage(JSON.stringify({ t: 'viewport', x: 120, y: -40, zoom: 900 }))).toEqual({
      t: 'viewport',
      x: 120,
      y: -40,
      zoom: 256,
    });
    expect(decodeClientMessage(JSON.stringify({ t: 'viewport', x: -8, y: 8, zoom: 0.0001 }))).toMatchObject({ zoom: 0.02 });
    // Non-finite offsets are dropped entirely.
    expect(decodeClientMessage(JSON.stringify({ t: 'viewport', x: null, y: 0, zoom: 1 }))).toBeNull();
  });

  it('sends the local viewport as presence', () => {
    const sockets: FakeSocket[] = [];
    const client = createRoomClient(
      { onState: () => undefined, onCursor: () => undefined },
      () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
    );
    client.connect({ base: 'http://relay', roomId: 'r', nickname: 'Ada', clientId: 'me', allowPlaintext: true });
    sockets[0]!.fireOpen();
    client.sendViewport({ x: 10, y: -20, zoom: 2 });
    expect(JSON.parse(sockets[0]!.sent.at(-1)!)).toEqual({ t: 'viewport', x: 10, y: -20, zoom: 2 });
  });

  it('reports relay errors and ignores payloads it does not use', () => {
    const online = applyServerMessage(EMPTY_ROOM, welcome);
    expect(applyServerMessage(online, { t: 'error', code: 'rate', message: 'slow down' })).toMatchObject({
      phase: 'error',
      error: 'slow down',
    });
    // Snapshots and ops are not applied: this client only shows presence.
    expect(applyServerMessage(online, { t: 'snapshot', clientId: null, file: { anything: true }, seq: 3 })).toBe(online);
    expect(applyServerMessage(online, { t: 'pong' })).toBe(online);
  });

  it('keeps the peer colour and nickname from the relay', () => {
    const state = applyServerMessage(EMPTY_ROOM, {
      ...welcome,
      peers: [{ ...peer('other'), nickname: '  Ada   Lovelace ', color: '' }],
    } as ServerMessage);
    const entry = state.peers[0]!;
    expect(entry.nickname).toBe('Ada Lovelace');
    // No relay colour: a deterministic one is derived from the id.
    expect(entry.color).toMatch(/^hsl\(/);
  });

  it('centres the viewport on a followed cursor at the current zoom', () => {
    const viewport = followCursorViewport({ x: 100, y: 50 }, { width: 800, height: 600 }, { x: 0, y: 0, zoom: 2 });
    expect(viewport).toEqual({ zoom: 2, x: 800 / 2 - 200, y: 600 / 2 - 100 });
  });

  it('frames a selection box with padding and clamped zoom', () => {
    const viewport = frameBoundsViewport({ x: 100, y: 100, width: 200, height: 100 }, { width: 800, height: 600 }, { padding: 80 });
    expect(viewport.zoom).toBeCloseTo(Math.min((800 - 80) / 200, (600 - 80) / 100), 5);
    // A tiny box does not zoom past the cap.
    expect(frameBoundsViewport({ x: 0, y: 0, width: 1, height: 1 }, { width: 800, height: 600 }, { maxZoom: 4 }).zoom).toBe(4);
  });

  it('labels avatars with initials', () => {
    expect(initialsOf('Ada Lovelace')).toBe('AL');
    expect(initialsOf('ada')).toBe('A');
    expect(initialsOf('   ')).toBe('G');
  });

  it('ignores a superseded socket close so a new room is not reported offline', () => {
    const sockets: FakeSocket[] = [];
    const states: RoomState[] = [];
    const client = createRoomClient(
      { onState: (state) => states.push(state), onCursor: () => undefined },
      () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
    );

    client.connect({ base: 'http://localhost:8080', roomId: 'one', nickname: 'Ada', clientId: 'me', allowPlaintext: true });
    const first = sockets[0]!;
    // Capture the handlers as they were installed, before any supersede.
    const staleClose = first.onclose!;
    const staleError = first.onerror!;

    client.disconnect();
    client.connect({ base: 'http://localhost:8080', roomId: 'two', nickname: 'Ada', clientId: 'me', allowPlaintext: true });
    const second = sockets[1]!;
    expect(second.closed).toBe(false);
    expect(states.at(-1)).toMatchObject({ phase: 'connecting', roomId: 'two' });

    // The old socket's asynchronous close/error must not touch the new room.
    staleClose();
    staleError();
    expect(states.at(-1)).toMatchObject({ phase: 'connecting', roomId: 'two' });

    // The live socket still behaves normally.
    second.fireOpen();
    expect(second.sent).toHaveLength(1);
    second.fireMessage(welcome);
    // `welcome` carries the room the relay reports; the point is the phase flip.
    expect(states.at(-1)).toMatchObject({ phase: 'online' });
    second.fireClose();
    expect(states.at(-1)!.phase).toBe('offline');
  });

  it('supersedes an open connection when a new room is joined', () => {
    const sockets: FakeSocket[] = [];
    const states: RoomState[] = [];
    const client = createRoomClient(
      { onState: (state) => states.push(state), onCursor: () => undefined },
      () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
    );

    client.connect({ base: 'http://localhost:8080', roomId: 'one', nickname: 'Ada', clientId: 'me', allowPlaintext: true });
    sockets[0]!.fireOpen();
    sockets[0]!.fireMessage(welcome);
    expect(client.connected).toBe(true);

    const staleClose = sockets[0]!.onclose!;
    client.connect({ base: 'http://localhost:8080', roomId: 'two', nickname: 'Ada', clientId: 'me', allowPlaintext: true });
    // The previous socket is closed and inert; its late close is ignored.
    expect(sockets[0]!.closed).toBe(true);
    staleClose();
    expect(states.at(-1)).toMatchObject({ phase: 'connecting', roomId: 'two' });
    expect(client.connected).toBe(false);
  });

  it('does not send while there is no live socket', () => {
    const sockets: FakeSocket[] = [];
    const client = createRoomClient(
      { onState: () => undefined, onCursor: () => undefined },
      () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
    );
    // Offline: nothing is sent, and nothing throws.
    client.sendCursor({ x: 1, y: 2 });
    client.sendSelection(['a']);
    expect(sockets).toHaveLength(0);

    client.connect({ base: 'http://localhost:8080', roomId: 'one', nickname: 'Ada', clientId: 'me', allowPlaintext: true });
    client.sendCursor({ x: 1, y: 2 });
    expect(sockets[0]!.sent).toHaveLength(0); // still connecting

    sockets[0]!.fireOpen();
    client.sendCursor({ x: 1, y: 2 });
    client.sendSelection(['a']);
    expect(sockets[0]!.sent.map((line) => (JSON.parse(line) as { t: string }).t)).toEqual(['hello', 'cursor', 'selection']);
  });

  it('refuses to join a room without its key unless plaintext is explicit', () => {
    const sockets: FakeSocket[] = [];
    const states: RoomState[] = [];
    const client = createRoomClient(
      { onState: (state) => states.push(state), onCursor: () => undefined },
      () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
    );

    // No key and no opt-in: refused, with nothing sent to any relay.
    client.connect({ base: 'http://localhost:8080', roomId: 'one', nickname: 'Ada', clientId: 'me' });
    expect(sockets).toHaveLength(0);
    expect(states.at(-1)).toMatchObject({ phase: 'error', mode: null });
    expect(states.at(-1)!.error).toMatch(/encrypted/i);
    expect(client.connected).toBe(false);

    // A malformed key is its own error, even with plaintext allowed: it must
    // never be dropped in favour of an unencrypted join.
    client.connect({ base: 'http://localhost:8080', roomId: 'one', nickname: 'Ada', clientId: 'me', key: 'not-a-key', allowPlaintext: true });
    expect(sockets).toHaveLength(0);
    expect(states.at(-1)).toMatchObject({ phase: 'error', mode: null });
    expect(states.at(-1)!.error).toMatch(/not a valid room key/i);

    // The explicit plaintext mode joins, and is labelled as plaintext.
    client.connect({ base: 'http://localhost:8080', roomId: 'one', nickname: 'Ada', clientId: 'me', allowPlaintext: true });
    expect(sockets).toHaveLength(1);
    expect(states.at(-1)).toMatchObject({ phase: 'connecting', mode: 'plaintext' });
  });

  it('labels an encrypted join and keeps the key out of the socket URL and messages', () => {
    const sockets: FakeSocket[] = [];
    const urls: string[] = [];
    const states: RoomState[] = [];
    const client = createRoomClient(
      { onState: (state) => states.push(state), onCursor: () => undefined },
      (url) => {
        urls.push(url);
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
    );
    const key = generateRoomKey();
    const encoded = encodeRoomKey(key);
    client.connect({ base: 'http://localhost:8080', roomId: 'studio', nickname: 'Ada', clientId: 'me', key: encoded });

    expect(states.at(-1)).toMatchObject({ phase: 'connecting', mode: 'e2e' });
    // The key never reaches the relay: not in the URL, not in the hello.
    expect(urls[0]).toBe('ws://localhost:8080/collab?room=studio');
    expect(urls[0]).not.toContain(encoded);
    sockets[0]!.fireOpen();
    const hello = JSON.parse(sockets[0]!.sent[0] as string) as { t: string; e2e: boolean };
    expect(hello).toMatchObject({ t: 'hello', e2e: true });
    expect(sockets[0]!.sent[0]).not.toContain(encoded);
  });

  it('starts offline and stays usable without a room', () => {
    const state: RoomState = EMPTY_ROOM;
    expect(state.phase).toBe('offline');
    expect(state.peers).toEqual([]);
    expect(state.roomId).toBeNull();
  });
});
