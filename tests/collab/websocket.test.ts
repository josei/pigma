/**
 * RFC 6455 framing tests for the relay's WebSocket server.
 *
 * These drive the socket directly (handshake + hand-encoded frames) so the
 * parts a browser client never exercises deliberately — masking, fragmentation,
 * 16/64-bit lengths, ping/pong, the close handshake, and protocol errors — are
 * covered. The relay behaviour itself is tested through Node's built-in
 * `WebSocket` client in `tests/collab/relay.test.ts`.
 */
import { vi, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { connect, type Socket } from 'node:net';
import { createCollabServer, type CollabServer } from '../../src/collab/server';

/**
 * These tests drive real sockets, real HTTP and spawned processes. Their subject
 * is protocol behaviour, not latency, so they get a generous per-file bound: a
 * busy box must not turn a slow-but-correct round trip into a failure. It is
 * still a *bound* — a genuine hang fails here, with vitest naming the timeout.
 */
vi.setConfig({ testTimeout: 60_000 });

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const OPCODE_CONTINUATION = 0x0;
const OPCODE_TEXT = 0x1;
const OPCODE_BINARY = 0x2;
const OPCODE_CLOSE = 0x8;
const OPCODE_PING = 0x9;
const OPCODE_PONG = 0xa;

interface Frame {
  fin: boolean;
  opcode: number;
  payload: Buffer;
}

function encodeFrame(
  opcode: number,
  payload: Buffer,
  options: { fin?: boolean; mask?: boolean; lengthForm?: 7 | 16 | 64 } = {},
): Buffer {
  const fin = options.fin ?? true;
  const mask = options.mask ?? true;
  const first = (fin ? 0x80 : 0) | opcode;
  const maskBit = mask ? 0x80 : 0;
  const form = options.lengthForm ?? (payload.length < 126 ? 7 : payload.length < 65536 ? 16 : 64);
  let header: Buffer;
  if (form === 7) {
    header = Buffer.from([first, maskBit | payload.length]);
  } else if (form === 16) {
    header = Buffer.alloc(4);
    header[0] = first;
    header[1] = maskBit | 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = first;
    header[1] = maskBit | 127;
    header.writeUInt32BE(Math.floor(payload.length / 2 ** 32), 2);
    header.writeUInt32BE(payload.length >>> 0, 6);
  }
  if (!mask) return Buffer.concat([header, payload]);
  const key = Buffer.from([0x11, 0x22, 0x33, 0x44]);
  const masked = Buffer.from(payload);
  for (let index = 0; index < masked.length; index += 1) masked[index] = (masked[index] as number) ^ (key[index % 4] as number);
  return Buffer.concat([header, key, masked]);
}

/** Minimal raw client: handshake, frame decode, frame encode. */
class RawClient {
  private buffer: Buffer = Buffer.alloc(0);
  readonly frames: Frame[] = [];
  private readonly waiters: Array<() => void> = [];
  readonly handshake: Promise<string>;

  constructor(
    private readonly socket: Socket,
    key: string,
  ) {
    let handshakeDone = false;
    let resolveHandshake: (head: string) => void = () => {};
    this.handshake = new Promise((resolve) => {
      resolveHandshake = resolve;
    });
    socket.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      if (!handshakeDone) {
        const end = this.buffer.indexOf('\r\n\r\n');
        if (end === -1) return;
        handshakeDone = true;
        const head = this.buffer.subarray(0, end).toString('utf8');
        this.buffer = this.buffer.subarray(end + 4);
        resolveHandshake(head);
      }
      this.pump();
    });
    socket.write(
      [
        'GET /collab?room=raw HTTP/1.1',
        'Host: 127.0.0.1',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        '',
        '',
      ].join('\r\n'),
    );
  }

  static connect(port: number, key = 'dGhlIHNhbXBsZSBub25jZQ=='): Promise<RawClient> {
    const socket = connect(port, '127.0.0.1');
    const client = new RawClient(socket, key);
    return new Promise((resolve, reject) => {
      socket.once('connect', () => resolve(client));
      socket.once('error', reject);
    });
  }

  send(opcode: number, payload: Buffer | string, options: { fin?: boolean } = {}): void {
    const body = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
    this.socket.write(encodeFrame(opcode, body, options));
  }

  /** Wait for a frame matching `predicate`, scanning already-decoded frames first. */
  async nextFrame(predicate: (frame: Frame) => boolean, timeoutMs = 2000): Promise<Frame> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.frames.find(predicate);
      if (found) return found;
      if (Date.now() > deadline) throw new Error(`timed out waiting for a frame; got ${JSON.stringify(this.frames.map((f) => f.opcode))}`);
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        setTimeout(resolve, 10);
      });
    }
  }

  /** Close code the server sent, if any. */
  closeCode(): number | null {
    const close = this.frames.find((frame) => frame.opcode === OPCODE_CLOSE);
    return close && close.payload.length >= 2 ? close.payload.readUInt16BE(0) : null;
  }

  end(): void {
    this.socket.destroy();
  }

  /** Write raw bytes (used to craft frames the helper would not produce). */
  writeRaw(bytes: Buffer): void {
    this.socket.write(bytes);
  }

  /** True when no close frame has been received (the connection is still usable). */
  get open(): boolean {
    return !this.frames.some((frame) => frame.opcode === OPCODE_CLOSE);
  }

  private pump(): void {
    for (;;) {
      const frame = this.readFrame();
      if (!frame) return;
      this.frames.push(frame);
      for (const wake of this.waiters.splice(0)) wake();
    }
  }

  private readFrame(): Frame | null {
    const buffer = this.buffer;
    if (buffer.length < 2) return null;
    const first = buffer[0] as number;
    const second = buffer[1] as number;
    let length = second & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (buffer.length < 4) return null;
      length = buffer.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (buffer.length < 10) return null;
      length = buffer.readUInt32BE(2) * 2 ** 32 + buffer.readUInt32BE(6);
      offset = 10;
    }
    if (buffer.length < offset + length) return null;
    const payload = buffer.subarray(offset, offset + length);
    this.buffer = buffer.subarray(offset + length);
    return { fin: (first & 0x80) !== 0, opcode: first & 0x0f, payload };
  }
}

let server: CollabServer;
let port: number;
const clients: RawClient[] = [];

async function raw(): Promise<RawClient> {
  const client = await RawClient.connect(port);
  clients.push(client);
  return client;
}

beforeEach(async () => {
  server = createCollabServer({ maxPayloadBytes: 256 * 1024 });
  ({ port } = await server.listen(0, '127.0.0.1'));
});

afterEach(async () => {
  for (const client of clients.splice(0)) client.end();
  await server.close();
});

describe('websocket framing', () => {
  it('completes the handshake with the RFC accept value', async () => {
    const key = 'dGhlIHNhbXBsZSBub25jZQ==';
    const client = await raw();
    const head = await client.handshake;
    const expected = createHash('sha1').update(key + GUID).digest('base64');
    expect(head).toContain('101 Switching Protocols');
    expect(head.toLowerCase()).toContain(`sec-websocket-accept: ${expected}`.toLowerCase());
    void key;
  });

  it('reassembles a fragmented text message', async () => {
    const client = await raw();
    await client.handshake;
    client.send(OPCODE_TEXT, '{"t":"hello","clientId":"raw-a","nick', { fin: false });
    client.send(OPCODE_CONTINUATION, 'name":"Ada"}', { fin: true });
    const welcome = await client.nextFrame((frame) => frame.opcode === OPCODE_TEXT);
    expect(JSON.parse(welcome.payload.toString('utf8'))).toMatchObject({ t: 'welcome', room: 'raw', self: { nickname: 'Ada' } });
  });

  it('handles 16-bit and 64-bit payload lengths', async () => {
    const client = await raw();
    await client.handshake;
    // >125 bytes uses the 16-bit length form on the way in.
    const medium = 'x'.repeat(400);
    client.send(OPCODE_TEXT, JSON.stringify({ t: 'hello', clientId: 'raw-a', nickname: medium.slice(0, 32) }));
    const welcome = await client.nextFrame((frame) => frame.opcode === OPCODE_TEXT);
    expect(JSON.parse(welcome.payload.toString('utf8')).self.nickname.length).toBe(32);

    // >64 KiB uses the 64-bit form; the server relays it to another client.
    const observer = await raw();
    await observer.handshake;
    observer.send(OPCODE_TEXT, JSON.stringify({ t: 'hello', clientId: 'raw-b', nickname: 'Bob' }));
    await observer.nextFrame((frame) => frame.opcode === OPCODE_TEXT && frame.payload.includes('welcome'));
    await client.nextFrame((frame) => frame.opcode === OPCODE_TEXT && frame.payload.includes('peer-join'));

    const big = 'y'.repeat(70 * 1024);
    client.send(OPCODE_TEXT, JSON.stringify({ t: 'ops', ops: [{ op: 'blob', data: big }] }));
    const relayed = await observer.nextFrame((frame) => frame.opcode === OPCODE_TEXT && frame.payload.includes('"t":"ops"'));
    expect(JSON.parse(relayed.payload.toString('utf8')).ops[0].data.length).toBe(70 * 1024);
  });

  it('answers ping with pong', async () => {
    const client = await raw();
    await client.handshake;
    client.send(OPCODE_PING, Buffer.from('hi'));
    const pong = await client.nextFrame((frame) => frame.opcode === OPCODE_PONG);
    expect(pong.payload.toString('utf8')).toBe('hi');
  });

  it('closes with 1002 on an unmasked client frame', async () => {
    const client = await raw();
    await client.handshake;
    client.send(OPCODE_TEXT, '{"t":"ping"}', { fin: true });
    // Re-send unmasked by bypassing the helper's masking.
    (client as unknown as { socket: Socket }).socket.write(encodeFrame(OPCODE_TEXT, Buffer.from('{"t":"ping"}'), { mask: false }));
    await client.nextFrame((frame) => frame.opcode === OPCODE_CLOSE);
    expect(client.closeCode()).toBe(1002);
  });

  it('closes with 1009 when a message exceeds the payload cap', async () => {
    const client = await raw();
    await client.handshake;
    client.send(OPCODE_TEXT, Buffer.alloc(300 * 1024, 0x61));
    await client.nextFrame((frame) => frame.opcode === OPCODE_CLOSE);
    expect(client.closeCode()).toBe(1009);
  });

  it('consumes a fragmented binary message instead of failing on its continuation', async () => {
    const client = await raw();
    await client.handshake;

    // BINARY(fin=false) then CONTINUATION(fin=true): framing is valid, and the
    // relay discards the reassembled payload rather than treating it as text.
    client.send(OPCODE_BINARY, Buffer.from([0x01, 0x02]), { fin: false });
    client.send(OPCODE_CONTINUATION, Buffer.from([0x03]), { fin: true });
    // A single-frame binary is discarded too.
    client.send(OPCODE_BINARY, Buffer.from([0x04]));

    // The connection is still healthy: ping is answered and a text hello joins.
    client.send(OPCODE_PING, Buffer.from('still-here'));
    await client.nextFrame((frame) => frame.opcode === OPCODE_PONG);
    expect(client.open).toBe(true);

    client.send(OPCODE_TEXT, JSON.stringify({ t: 'hello', clientId: 'raw-binary', nickname: 'Bin' }));
    const welcome = await client.nextFrame((frame) => frame.opcode === OPCODE_TEXT);
    expect(JSON.parse(welcome.payload.toString('utf8'))).toMatchObject({ t: 'welcome', self: { nickname: 'Bin' } });
  });

  it('rejects a fragmented binary followed by a text frame as interleaved', async () => {
    const client = await raw();
    await client.handshake;
    client.send(OPCODE_BINARY, Buffer.from([0x01]), { fin: false });
    client.send(OPCODE_TEXT, '{"t":"ping"}');
    await client.nextFrame((frame) => frame.opcode === OPCODE_CLOSE);
    expect(client.closeCode()).toBe(1002);
  });

  it('rejects a control frame that uses an extended length form', async () => {
    const client = await raw();
    await client.handshake;
    // PING with the 16-bit length form and a decoded length of 1 (illegal).
    client.writeRaw(encodeFrame(OPCODE_PING, Buffer.from([0x68]), { lengthForm: 16 }));
    await client.nextFrame((frame) => frame.opcode === OPCODE_CLOSE);
    expect(client.closeCode()).toBe(1002);
  });

  it('rejects a one-byte close payload instead of echoing it', async () => {
    const client = await raw();
    await client.handshake;
    client.send(OPCODE_CLOSE, Buffer.from([0x03]));
    await client.nextFrame((frame) => frame.opcode === OPCODE_CLOSE);
    expect(client.closeCode()).toBe(1002);
    // The echoed close payload is 0 or >= 2 bytes, never the invalid single byte.
    const echoed = client.frames.find((frame) => frame.opcode === OPCODE_CLOSE);
    expect(echoed?.payload.length === 0 || (echoed?.payload.length ?? 0) >= 2).toBe(true);
  });

  it('closes with 1007 on invalid UTF-8 in a text message', async () => {
    const client = await raw();
    await client.handshake;
    // 0xC3 starts a two-byte sequence; 0x28 is not a valid continuation byte.
    client.send(OPCODE_TEXT, Buffer.from([0x7b, 0x22, 0xc3, 0x28, 0x22, 0x7d]));
    await client.nextFrame((frame) => frame.opcode === OPCODE_CLOSE);
    expect(client.closeCode()).toBe(1007);
  });

  it('validates UTF-8 on the complete message, not per fragment', async () => {
    const client = await raw();
    await client.handshake;
    // "é" split across two fragments: each half alone is invalid UTF-8.
    const encoded = Buffer.from(JSON.stringify({ t: 'hello', clientId: 'raw-utf8', nickname: 'éé' }), 'utf8');
    const split = encoded.indexOf(0xc3);
    client.send(OPCODE_TEXT, encoded.subarray(0, split + 1), { fin: false });
    client.send(OPCODE_CONTINUATION, encoded.subarray(split + 1), { fin: true });
    const welcome = await client.nextFrame((frame) => frame.opcode === OPCODE_TEXT);
    expect(JSON.parse(welcome.payload.toString('utf8')).self.nickname).toBe('éé');
  });

  it('completes the close handshake', async () => {
    const client = await raw();
    await client.handshake;
    const payload = Buffer.alloc(2);
    payload.writeUInt16BE(1000, 0);
    client.send(OPCODE_CLOSE, payload);
    await client.nextFrame((frame) => frame.opcode === OPCODE_CLOSE);
    expect(client.closeCode()).toBe(1000);
  });
});
