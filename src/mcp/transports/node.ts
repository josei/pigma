/**
 * Node HTTP listener for the Streamable HTTP transport.
 *
 * Exposes `createHttpHandler` over `node:http`, so the MCP server can be driven
 * by any HTTP-capable MCP client. Kept in its own module so the protocol core
 * stays runtime-agnostic.
 *
 * The listener is also where the true peer address is known: it is appended to
 * the handler's headers as `x-pigma-peer`. A client-supplied value cannot win —
 * duplicate header values combine, so the loopback check fails closed — which
 * lets token minting trust the socket address instead of a header.
 */
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { McpServer } from '../protocol';
import { createHttpHandler, type HttpTransportOptions } from './http';

export interface HttpServerHandle {
  url: string;
  /** Status/health surface for the MCP panel. */
  statusUrl: string;
  port: number;
  close(): Promise<void>;
}

function readBody(request: IncomingMessage): Promise<Buffer | undefined> {
  // `Promise.withResolvers` needs lib ES2024; this project targets ES2022.
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(chunks.length > 0 ? Buffer.concat(chunks) : undefined));
    request.on('error', reject);
  });
}

/**
 * Bridge a fetch-style handler onto Node's request/response pair. Shared by the
 * standalone MCP server and by a deployment that mounts the same handler on its
 * own HTTP server (self-host), so the transport is literally the same code.
 */
export function toNodeHandler(
  handler: (request: Request) => Promise<Response>,
): (request: IncomingMessage, response: ServerResponse) => void {
  return (request, response) => {
    void (async () => {
      const body = await readBody(request);
      const host = request.headers.host ?? 'localhost';
      const url = `http://${host}${request.url ?? '/'}`;
      const headers = Object.entries(request.headers).flatMap(([key, value]) =>
        value === undefined ? [] : [[key, Array.isArray(value) ? value.join(', ') : value] as [string, string]],
      );
      // The real peer, set last so a client cannot spoof it.
      headers.push(['x-pigma-peer', request.socket.remoteAddress ?? '']);
      const fetchRequest = new Request(url, {
        method: request.method ?? 'GET',
        headers,
        body: body ? new Uint8Array(body) : undefined,
      });
      const fetchResponse = await handler(fetchRequest);
      response.writeHead(fetchResponse.status, Object.fromEntries(fetchResponse.headers.entries()));
      response.end(Buffer.from(await fetchResponse.arrayBuffer()));
    })();
  };
}
export async function startHttpServer(
  server: McpServer,
  options: { port?: number; host?: string } & HttpTransportOptions = {},
): Promise<HttpServerHandle> {
  const host = options.host ?? '127.0.0.1';
  // Listen first: the endpoint advertised in the status surface and the harness
  // config must be the address clients will actually reach.
  const httpServer = createServer();
  await new Promise<void>((resolve) => httpServer.listen(options.port ?? 0, host, resolve));
  const address = httpServer.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const endpoint = options.endpoint ?? `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}/mcp`;

  const handler = createHttpHandler(server, { ...options, endpoint });

  httpServer.on('request', toNodeHandler(handler));

  return {
    url: endpoint,
    statusUrl: `${endpoint}/status`,
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
