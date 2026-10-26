/**
 * Shared helpers for the collaboration tests: a promise wrapper over Node's
 * built-in WebSocket client and a raw handshake client.
 *
 * Not a test file itself (the vitest include is `*.test.ts`), so both the relay
 * suite and the limits suite use exactly one implementation.
 */
import { connect as netConnect, type Socket } from 'node:net';
import { createCollabServer, type CollabServer, type CollabServerOptions } from '../../src/collab/server';
import type { ServerMessage } from '../../src/collab/protocol';

/** Thin promise wrapper over Node's global WebSocket client. */
export class TestClient {
  private readonly queue: ServerMessage[] = [];
  private readonly waiters: Array<() => void> = [];
  private closed = false;
  private closeInfo: { code: number; reason: string } | null = null;

  private constructor(readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => {
      this.queue.push(JSON.parse(String((event as MessageEvent).data)) as ServerMessage);
      for (const wake of this.waiters.splice(0)) wake();
    });
    socket.addEventListener('close', (event) => {
      this.closed = true;
      const close = event as CloseEvent;
      this.closeInfo = { code: close.code, reason: close.reason };
      for (const wake of this.waiters.splice(0)) wake();
    });
  }

  static async connect(url: string): Promise<TestClient> {
    const socket = new WebSocket(url);
    const client = new TestClient(socket);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true });
      socket.addEventListener('error', () => reject(new Error(`failed to connect to ${url}`)), { once: true });
      socket.addEventListener('close', (event) => reject(new Error(`closed before open: ${(event as CloseEvent).code}`)), { once: true });
    });
    return client;
  }

  send(message: unknown): void {
    this.socket.send(JSON.stringify(message));
  }

  received(): ServerMessage[] {
    return [...this.queue];
  }

  /** Wait for a message of `type` (optionally matching `match`), scanning what already arrived first. */
  async next<K extends ServerMessage['t']>(
    type: K,
    match?: (message: Extract<ServerMessage, { t: K }>) => boolean,
    timeoutMs = 3000,
  ): Promise<Extract<ServerMessage, { t: K }>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.queue.find(
        (message): message is Extract<ServerMessage, { t: K }> =>
          message.t === type && (!match || match(message as Extract<ServerMessage, { t: K }>)),
      );
      if (found) return found;
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for a ${type} message; received: ${JSON.stringify(this.queue)}`);
      }
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        setTimeout(resolve, 25);
      });
    }
  }

  /** Wait for the socket to close and report the code the server sent. */
  async waitForClose(timeoutMs = 3000): Promise<{ code: number; reason: string }> {
    const deadline = Date.now() + timeoutMs;
    while (!this.closed) {
      if (Date.now() > deadline) throw new Error('timed out waiting for the socket to close');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return this.closeInfo ?? { code: 0, reason: '' };
  }

  get isClosed(): boolean {
    return this.closed;
  }

  close(): void {
    try {
      this.socket.close();
    } catch {
      // already closing
    }
  }
}

/** A started relay plus the clients it handed out. */
export interface RelayHarness {
  server: CollabServer;
  wsBase: string;
  httpBase: string;
  connect(room?: string, token?: string): Promise<TestClient>;
  /** Raw socket that performs the HTTP upgrade and returns the status line. */
  upgradeStatus(room?: string, token?: string): Promise<string>;
  close(): Promise<void>;
}

export async function startRelay(options: CollabServerOptions = {}): Promise<RelayHarness> {
  const server = createCollabServer(options);
  const { port } = await server.listen(0, '127.0.0.1');
  const clients: TestClient[] = [];

  return {
    server,
    wsBase: `ws://127.0.0.1:${port}`,
    httpBase: `http://127.0.0.1:${port}`,
    async connect(room = 'room-1', token) {
      const client = await TestClient.connect(`ws://127.0.0.1:${port}/collab?room=${room}${token ? `&token=${token}` : ''}`);
      clients.push(client);
      return client;
    },
    upgradeStatus(room = 'room-1', token) {
      return new Promise<string>((resolve, reject) => {
        const socket: Socket = netConnect(port, '127.0.0.1', () => {
          socket.write(
            [
              `GET /collab?room=${room}${token ? `&token=${token}` : ''} HTTP/1.1`,
              `Host: 127.0.0.1:${port}`,
              'Upgrade: websocket',
              'Connection: Upgrade',
              'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
              'Sec-WebSocket-Version: 13',
              '',
              '',
            ].join('\r\n'),
          );
        });
        let buffer = '';
        socket.on('data', (chunk: Buffer) => {
          buffer += chunk.toString('utf8');
          const end = buffer.indexOf('\r\n');
          if (end === -1) return;
          socket.destroy();
          resolve(buffer.slice(0, end));
        });
        socket.on('error', reject);
        socket.setTimeout(2000, () => {
          socket.destroy();
          reject(new Error('upgrade timed out'));
        });
      });
    },
    async close() {
      for (const client of clients.splice(0)) client.close();
      await server.close();
    },
  };
}
