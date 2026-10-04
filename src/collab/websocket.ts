/**
 * Minimal RFC 6455 WebSocket server, implemented on Node's `http` upgrade.
 *
 * The relay is meant to be self-hosted with one command, so it carries no
 * runtime dependency: `ws` is not in `package.json`, and this module needs only
 * `node:crypto` plus the socket Node already hands us. Scope is deliberately
 * the subset a browser client actually uses — text frames (fragmented or not),
 * ping/pong, and the close handshake. Binary messages are accepted at the
 * framing level and **discarded** (a fragmented binary is tracked and its
 * continuations consumed, so it can never be mistaken for a protocol error);
 * extensions and subprotocols are not negotiated. Text messages are UTF-8
 * validated when complete (1007 on invalid), as RFC 6455 requires.
 *
 * Server frames are unmasked, client frames must be masked, and every frame is
 * bounded by `maxPayloadBytes` (a client that exceeds it is closed with 1009).
 */
import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const OPCODE_CONTINUATION = 0x0;
const OPCODE_TEXT = 0x1;
const OPCODE_BINARY = 0x2;
const OPCODE_CLOSE = 0x8;
const OPCODE_PING = 0x9;
const OPCODE_PONG = 0xa;

export const CLOSE_PROTOCOL_ERROR = 1002;
export const CLOSE_INVALID_PAYLOAD = 1007;
export const CLOSE_TOO_LARGE = 1009;

/** RFC 6455 requires valid UTF-8 in text messages; a lossy decode would hide that. */
const UTF8 = new TextDecoder('utf-8', { fatal: true });

export interface WebSocketHandlers {
  onMessage(text: string): void;
  onClose(): void;
}

export interface WebSocketConnection {
  readonly closed: boolean;
  send(text: string): void;
  close(code?: number, reason?: string): void;
  ping(): void;
}

export interface AcceptOptions {
  /** Largest single message (after reassembly) the connection will accept. */
  maxPayloadBytes?: number;
  handlers: WebSocketHandlers;
}

export function isWebSocketUpgrade(request: IncomingMessage): boolean {
  return (
    request.method === 'GET' &&
    (request.headers.upgrade ?? '').toLowerCase() === 'websocket' &&
    (request.headers.connection ?? '').toLowerCase().split(',').map((part) => part.trim()).includes('upgrade') &&
    typeof request.headers['sec-websocket-key'] === 'string'
  );
}

/** Complete the handshake and take over the socket. */
export function acceptWebSocket(request: IncomingMessage, socket: Duplex, options: AcceptOptions): WebSocketConnection {
  const key = request.headers['sec-websocket-key'] as string;
  const accept = createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '',
      '',
    ].join('\r\n'),
  );

  return new Connection(socket, options.maxPayloadBytes ?? 8 * 1024 * 1024, options.handlers);
}

class Connection implements WebSocketConnection {
  private buffer: Buffer = Buffer.alloc(0);
  private fragments: Buffer[] = [];
  private fragmentOpcode = 0;
  private isClosed = false;
  private closeSent = false;

  constructor(
    private readonly socket: Duplex,
    private readonly maxPayload: number,
    private readonly handlers: WebSocketHandlers,
  ) {
    socket.on('data', (chunk: Buffer) => this.onData(chunk));
    socket.on('error', () => this.destroy());
    socket.on('close', () => this.finish());
  }

  get closed(): boolean {
    return this.isClosed;
  }

  send(text: string): void {
    if (this.isClosed) return;
    this.writeFrame(OPCODE_TEXT, Buffer.from(text, 'utf8'));
  }

  ping(): void {
    if (this.isClosed) return;
    this.writeFrame(OPCODE_PING, Buffer.alloc(0));
  }

  close(code = 1000, reason = ''): void {
    // Idempotent: a second close (e.g. a limit tripping on every queued frame)
    // must not emit a second close frame.
    if (this.isClosed || this.closeSent) return;
    const payload = Buffer.alloc(2 + Buffer.byteLength(reason));
    payload.writeUInt16BE(code, 0);
    payload.write(reason, 2);
    this.writeFrame(OPCODE_CLOSE, payload);
    this.closeSent = true;
    // Give the peer a moment to reply with its own close, then hang up.
    setTimeout(() => this.destroy(), 250).unref?.();
  }

  private onData(chunk: Buffer): void {
    this.buffer = (this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk])) as Buffer;
    for (;;) {
      const frame = this.readFrame();
      if (!frame) return;
      if (frame === 'protocol-error') {
        this.fail(CLOSE_PROTOCOL_ERROR, 'protocol error');
        return;
      }
      if (frame === 'too-large') {
        this.fail(CLOSE_TOO_LARGE, 'message too large');
        return;
      }
      this.handleFrame(frame);
      if (this.isClosed) return;
    }
  }

  /** Read one frame off the buffer, or null when more bytes are needed. */
  private readFrame(): { fin: boolean; opcode: number; payload: Buffer } | 'protocol-error' | 'too-large' | null {
    const buffer = this.buffer;
    if (buffer.length < 2) return null;
    const first = buffer[0] as number;
    const second = buffer[1] as number;
    const fin = (first & 0x80) !== 0;
    const rsv = first & 0x70;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let offset = 2;

    if (rsv !== 0) return 'protocol-error';
    // A server must reject unmasked client frames.
    if (!masked) return 'protocol-error';

    // Control frames must use the 7-bit length form, so check the code before
    // decoding it: a control frame declaring 126/127 is a protocol error even
    // when the decoded value happens to fit in 125 bytes.
    const isControl = opcode >= 0x8;
    if (isControl && (length > 125 || !fin)) return 'protocol-error';

    if (length === 126) {
      if (buffer.length < offset + 2) return null;
      length = buffer.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (buffer.length < offset + 8) return null;
      const high = buffer.readUInt32BE(offset);
      const low = buffer.readUInt32BE(offset + 4);
      if (high > 0x1fffff) return 'too-large';
      length = high * 2 ** 32 + low;
      offset += 8;
    }
    if (length > this.maxPayload) return 'too-large';

    if (buffer.length < offset + 4 + length) return null;
    const maskKey = buffer.subarray(offset, offset + 4);
    offset += 4;
    const payload = Buffer.allocUnsafe(length);
    for (let index = 0; index < length; index += 1) {
      payload[index] = (buffer[offset + index] as number) ^ (maskKey[index % 4] as number);
    }
    this.buffer = buffer.subarray(offset + length) as Buffer;
    return { fin, opcode, payload };
  }

  private handleFrame(frame: { fin: boolean; opcode: number; payload: Buffer }): void {
    const { fin, opcode, payload } = frame;

    if (opcode === OPCODE_CLOSE) {
      // A close payload is either empty or a 2-byte code plus optional reason;
      // one byte is invalid, and echoing it verbatim would send an invalid
      // close frame back.
      if (payload.length === 1) return this.fail(CLOSE_PROTOCOL_ERROR, 'invalid close payload');
      if (!this.closeSent) {
        this.closeSent = true;
        this.writeFrame(OPCODE_CLOSE, payload.length >= 2 ? payload.subarray(0, 2) : Buffer.alloc(0));
      }
      this.destroy();
      return;
    }
    if (opcode === OPCODE_PING) {
      this.writeFrame(OPCODE_PONG, payload);
      return;
    }
    if (opcode === OPCODE_PONG) return;

    if (opcode === OPCODE_CONTINUATION) {
      // Binary messages are tracked exactly like text ones so a continuation
      // after a fragmented binary is consumed rather than read as a protocol
      // error; the reassembled binary payload is then discarded.
      if (this.fragmentOpcode === 0) return this.fail(CLOSE_PROTOCOL_ERROR, 'unexpected continuation');
      this.fragments.push(payload);
    } else if (opcode === OPCODE_TEXT || opcode === OPCODE_BINARY) {
      if (this.fragmentOpcode !== 0) return this.fail(CLOSE_PROTOCOL_ERROR, 'interleaved fragments');
      this.fragmentOpcode = opcode;
      this.fragments.push(payload);
    } else {
      return this.fail(CLOSE_PROTOCOL_ERROR, 'unsupported opcode');
    }

    const total = this.fragments.reduce((size, part) => size + part.length, 0);
    if (total > this.maxPayload) return this.fail(CLOSE_TOO_LARGE, 'message too large');
    if (!fin) return;

    const completedOpcode = this.fragmentOpcode;
    const message = Buffer.concat(this.fragments);
    this.fragments = [];
    this.fragmentOpcode = 0;

    // Binary is not part of the relay's protocol: consume and drop it.
    if (completedOpcode === OPCODE_BINARY) return;

    let text: string;
    try {
      text = UTF8.decode(message);
    } catch {
      return this.fail(CLOSE_INVALID_PAYLOAD, 'invalid utf-8 in text message');
    }
    this.handlers.onMessage(text);
  }

  private writeFrame(opcode: number, payload: Buffer): void {
    if (this.isClosed) return;
    const length = payload.length;
    let header: Buffer;
    if (length < 126) {
      header = Buffer.from([0x80 | opcode, length]);
    } else if (length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeUInt32BE(Math.floor(length / 2 ** 32), 2);
      header.writeUInt32BE(length >>> 0, 6);
    }
    try {
      this.socket.write(Buffer.concat([header, payload]));
    } catch {
      this.destroy();
    }
  }

  private fail(code: number, reason: string): void {
    this.close(code, reason);
  }

  private destroy(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.socket.end();
    this.handlers.onClose();
  }

  private finish(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.handlers.onClose();
  }
}
