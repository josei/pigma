/**
 * Local relay for the running-browser bridge.
 *
 * A browser cannot accept inbound connections, so the editor **connects out**
 * to this relay over Server-Sent Events (`GET /bridge/events`) and posts
 * command results back (`POST /bridge/result`). The relay exposes the browser's
 * document as a {@link DocumentSession}, which an MCP server then serves to any
 * external MCP client over stdio or Streamable HTTP.
 *
 * Correctness:
 *  - the mirror is kept live: the browser pushes on connect and after every
 *    local change (draw/select/undo), each with a monotonically increasing
 *    `revision`; out-of-order pushes are ignored and a reconnect resets it;
 *  - remote writes carry the revision the caller read and are rejected by the
 *    editor if it has moved on (stale revision) — no lost edits, no false
 *    success;
 *  - writes await the browser's ACK; a timeout or disconnect rejects the
 *    pending command (surfaced as a tool error) and clears its timer, so a
 *    settled command can never fire a late rejection;
 *  - multiple editors are tracked; the most recent is active and disconnects are
 *    detected on both the request and response sockets.
 *
 * Security: loopback-only by default, a per-run token, Host/Origin validation,
 * and origin-scoped CORS. No client allowlist.
 */
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { PigmaFile } from '../model/types';
import { McpToolError } from './errors';
import type { TokenStore } from './tokens';
import type { DocumentSession } from './session';

interface PendingCommand {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface Connection {
  res: ServerResponse;
  name: string;
  /** Client-generated id used to attribute state pushes to this connection. */
  id: string;
}

export interface RelayStatus {
  connected: boolean;
  client: string | null;
  connections: number;
  commands: number;
  revision: number;
}

export interface RelayHandle {
  url: string;
  token: string;
  session: DocumentSession;
  /**
   * The bridge's own request handler, for a deployment that mounts it beside
   * other surfaces: returns true when it CLAIMED the request (answered it), false
   * to let the caller's other handlers try. It claims only its own `/bridge`
   * prefix.
   */
  handle(request: IncomingMessage, response: ServerResponse): boolean;
  status(): RelayStatus;
  close(): Promise<void>;
}

/**
 * The bridge without its own listener: the same state machine and routes, so a
 * deployment can mount it beside other surfaces (the hosted address serves the
 * app, the rooms relay, `/mcp` and the bridge from one port).
 */
export interface BridgeHandle {
  token: string;
  session: DocumentSession;
  status(): RelayStatus;
  /** Node request handler. Returns true when the request was one of ours. */
  handle(request: IncomingMessage, response: ServerResponse): boolean;
  close(): Promise<void>;
}

/** The one place this number is defined; `bin.ts` imports it rather than repeating it. */
export const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;

export interface RelayOptions {
  port?: number;
  host?: string;
  token?: string;
  /**
   * Session tokens a hosted deployment minted for MCP clients. When present, the
   * bridge accepts one of these as well as its own token, so an editor on the
   * hosted site can connect without knowing the operator's secret.
   */
  sessionTokens?: TokenStore;
  /**
   * Hosts the bridge answers for. Defaults to loopback. A hosted deployment adds
   * its public host, so the editor can connect over the tunnel — the TOKEN is
   * still required, so this widens reachability, not access.
   */
  allowedHosts?: string[];
  /**
   * Origins the bridge accepts. Defaults to loopback. A hosted deployment adds its
   * public origin, because the editor's PUSH is a POST that carries an Origin while
   * its SSE connect is a GET that does not — so a host-only allowlist lets the
   * stream open and refuses every push. The origin gate is CSRF protection: for a
   * page SERVED BY that origin the answer is to allow that origin, never to drop
   * the gate. The TOKEN gate is unchanged.
   */
  allowedOrigins?: string[];
  /**
   * How long one bridge command may take before it is failed.
   *
   * THE INTENT IS LIVENESS — the comment on `failPending` says "their editor is
   * gone or stalled" — but nothing in the protocol can tell "stalled" from "busy":
   * the editor sends no progress while it runs a command, and the only heartbeat
   * is server -> client. So this timer is the sole watcher, and at 10 s it killed
   * healthy work under load (the browser suite's B11d: `setFile` timed out and the
   * import never completed).
   *
   * The work is a whole document import plus a settle, so the budget is raised to
   * what the harness already uses in practice (the tests pass 60 s). 30 s keeps it
   * bounded while covering the real work.
   *
   * THE PROPER FIX, reported rather than done here: have the editor emit progress
   * for a command id, and reset THAT command's timer on it. Then liveness and work
   * duration are genuinely separate.
   */
  commandTimeoutMs?: number;
}

// ONE definition of the loopback origins, shared with the MCP handler: two copies
// of the same list is how `--public-url` came to reach one allowlist and not the
// other.
import { DEFAULT_ORIGINS } from './transports/http';

/** The hosts the bridge answers for when no allowlist is given: loopback only. */
export const DEFAULT_BRIDGE_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]'];

/**
 * Is this Host header one the bridge answers for?
 *
 * THIS WAS HARDCODED LOOPBACK WITH NO OPTION, which refused every public Host — so
 * a hosted editor could never connect the bridge over a tunnel. That contradicted
 * the design: `sessionTokens` exists "so an editor on the hosted site can connect
 * without knowing the operator's secret", and `--hosted` wires the MCP session to
 * the bridge session. A HOSTED EDITOR CONNECTING IS THE INTENT; the loopback list
 * was an un-parameterised default, not a security posture. The security boundary
 * is the TOKEN, which is unchanged and still required.
 */
function hostAllowed(host: string | null, allowed: string[]): boolean {
  if (!host) return true;
  const hostname = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0] ?? host;
  return allowed.includes(hostname);
}

function originAllowed(origin: string | null, allowed: string[]): boolean {
  if (!origin) return true;
  const match = /^(https?:\/\/[^/]+)/.exec(origin);
  const base = match?.[1] ?? origin;
  return allowed.some((entry) => base === entry || base.startsWith(`${entry}:`));
}

interface SyncPayload {
  file?: PigmaFile;
  selection?: string[];
  revision?: number;
}

export function createBridge(options: RelayOptions = {}): BridgeHandle {
  const token = options.token ?? randomBytes(16).toString('hex');
  const sessionTokens = options.sessionTokens;
  const allowedHosts = options.allowedHosts ?? DEFAULT_BRIDGE_HOSTS;
  /**
   * A hosted deployment mints per-session tokens for MCP clients (`POST
   * /mcp/token`). The editor's bridge must accept one too: the operator's
   * `--bridge-token` is a deployment secret, and a user of the hosted site has
   * no way to know it. Accepting a live session token is what makes "MCP with no
   * download" possible; the operator token keeps working unchanged.
   */
  const accepts = (value: string | null | undefined): boolean => {
    if (value === token) return true;
    if (!sessionTokens || !value) return false;
    return sessionTokens.verify(value).ok;
  };
  const timeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const allowedOrigins = options.allowedOrigins ?? DEFAULT_ORIGINS;

  const connections = new Set<Connection>();
  /** Connection ids seen before, so a reconnect resumes instead of taking over. */
  const knownClients = new Map<string, boolean>();
  let active: Connection | null = null;
  let nextId = 1;
  let commands = 0;
  let revision = 0;
  let remoteFile: PigmaFile | null = null;
  let remoteSelection: string[] = [];
  const pending = new Map<number, PendingCommand>();

  const noEditor = (): McpToolError =>
    new McpToolError('No editor is connected to the Pigma bridge. Open the editor and connect the bridge.');

  /** Reject every in-flight command (their editor is gone or stalled). */
  const failPending = (error: Error): void => {
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
      pending.delete(id);
    }
  };

  const send = (method: string, params: unknown): Promise<unknown> => {
    const target = active;
    if (!target) return Promise.reject(noEditor());
    const id = nextId++;
    commands += 1;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        // Clear the entry so a settled command can never fire a late rejection.
        pending.delete(id);
        reject(new McpToolError(`Bridge command "${method}" timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      target.res.write(`event: command\ndata: ${JSON.stringify({ id, method, params })}\n\n`);
    });
  };

  const applySync = (sync: SyncPayload, clientId: string | undefined): void => {
    // Only the active editor's pushes update the mirror: a second connected
    // window (another tab, a dedicated bridge window) must not clobber it.
    if (clientId !== undefined && active && clientId !== active.id) return;
    if (sync.revision !== undefined && sync.revision < revision) return;
    if (sync.revision !== undefined) revision = sync.revision;
    if (sync.file) remoteFile = sync.file;
    if (sync.selection) remoteSelection = sync.selection;
  };

  /** Pull the active editor's authoritative state into the mirror. */
  const refreshFromActive = async (): Promise<void> => {
    try {
      const state = (await send('getState', {})) as
        | { file?: PigmaFile; selection?: string[]; revision?: number }
        | undefined;
      if (state?.file) remoteFile = state.file;
      if (state?.selection) remoteSelection = state.selection;
      if (typeof state?.revision === 'number') revision = state.revision;
    } catch {
      // The editor may have gone away again; the next push will resync.
    }
  };

  const readBody = (request: IncomingMessage): Promise<string> =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      request.on('error', reject);
    });

  const remote: DocumentSession = {
    getFile: () => {
      if (!active) throw noEditor();
      return remoteFile;
    },
    getSnapshot: async () => {
      if (!active) throw noEditor();
      // Authoritative round trip: the editor's current state and revision.
      await refreshFromActive();
      return { file: remoteFile, revision };
    },
    setFile: async (file, options) => {
      // Guarded callers pass this call's snapshot revision; an unguarded caller
      // omits it and the editor applies unconditionally.
      const params = options?.expectedRevision === undefined ? { file } : { file, expectedRevision: options.expectedRevision };
      const ack = (await send('setFile', params)) as { revision?: number } | undefined;
      remoteFile = file;
      if (typeof ack?.revision === 'number') revision = ack.revision;
    },
    getSelection: () => {
      if (!active) throw noEditor();
      return [...remoteSelection];
    },
    setSelection: async (ids, options) => {
      const params = options?.expectedRevision === undefined ? { ids } : { ids, expectedRevision: options.expectedRevision };
      const ack = (await send('setSelection', params)) as { revision?: number } | undefined;
      remoteSelection = [...ids];
      if (typeof ack?.revision === 'number') revision = ack.revision;
    },
  };

  const handleRequest = (request: IncomingMessage, response: ServerResponse): boolean => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    // SCOPE FIRST, THEN CHECK. The bridge answers for ITS OWN PREFIX only; every
    // other path falls through to the deployment's other handlers. Running the
    // host/origin check before any path test claimed EVERY request, so a public
    // deployment's app root got the bridge's 403 instead of the app.
    if (!url.pathname.startsWith('/bridge')) return false;
    const origin = request.headers.origin ?? null;
    if (!hostAllowed(request.headers.host ?? null, allowedHosts) || !originAllowed(origin, allowedOrigins)) {
      response.writeHead(403, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'host/origin not allowed' }));
      return true;
    }
    const cors: Record<string, string> = origin
      ? {
          'access-control-allow-origin': origin,
          vary: 'origin',
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': 'content-type, x-pigma-token',
        }
      : {};

    if (request.method === 'OPTIONS') {
      response.writeHead(204, cors);
      response.end();
      return true;
    }

    if (url.pathname === '/bridge/events' && request.method === 'GET') {
      if (!accepts(url.searchParams.get('token'))) {
        response.writeHead(401, { 'content-type': 'application/json', ...cors });
        response.end(JSON.stringify({ error: 'invalid token' }));
        return true;
      }
      const requestedId =
        url.searchParams.get('cid') ?? `${url.searchParams.get('client') ?? 'editor'}-${connections.size + 1}`;
      const isNewEditor = !knownClients.has(requestedId);
      // Only a brand-new editor (an explicit connect) takes over the mirror, or a
      // reconnect when nothing is active. A stale window whose EventSource retries
      // must not steal activity from the editor the user just connected — that
      // would clobber its selection with the stale window's empty one.
      const takesOver = isNewEditor || active === null;
      if (takesOver) {
        // A fresh editor restarts the revision counter, so reset the mirror;
        // otherwise its (lower) revisions would be ignored.
        revision = 0;
        remoteFile = null;
        remoteSelection = [];
      }
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
        ...cors,
      });
      response.write(`event: hello\ndata: ${JSON.stringify({ server: 'pigma-relay' })}\n\n`);
      const connection: Connection = { res: response, name: url.searchParams.get('client') ?? 'editor', id: requestedId };
      connections.add(connection);
      if (takesOver) active = connection;
      knownClients.set(connection.id, active === connection);

      const heartbeat = setInterval(() => response.write(': ping\n\n'), 15_000);
      let cleaned = false;
      const cleanup = (): void => {
        if (cleaned) return;
        cleaned = true;
        clearInterval(heartbeat);
        connections.delete(connection);
        knownClients.set(connection.id, false);
        if (active === connection) {
          active = [...connections].at(-1) ?? null;
          if (active) {
            knownClients.set(active.id, true);
            // Refresh the mirror from the newly promoted editor; its earlier
            // pushes were ignored while it was not active.
            void refreshFromActive();
          } else {
            // No editor left: fail in-flight commands rather than let them hang.
            failPending(noEditor());
          }
        }
      };
      request.on('close', cleanup);
      response.on('close', cleanup);
      return true;
    }

    if (url.pathname === '/bridge/result' && request.method === 'POST') {
      if (!accepts(typeof request.headers['x-pigma-token'] === 'string' ? request.headers['x-pigma-token'] : null)) {
        response.writeHead(401, { 'content-type': 'application/json', ...cors });
        response.end(JSON.stringify({ error: 'invalid token' }));
        return true;
      }
      // The editor's result body goes straight to the pending command: it is
      // never logged and never written anywhere — including on the error path, so
      // a malformed body is answered with 400 rather than thrown (a JSON parse
      // error message would otherwise quote the payload into a log).
      void readBody(request)
        .then((body) => {
          let payload: { id: number; ok: boolean; result?: unknown; error?: string; sync?: SyncPayload; client?: string };
          try {
            payload = JSON.parse(body) as typeof payload;
          } catch {
            response.writeHead(400, { 'content-type': 'application/json', ...cors });
            response.end(JSON.stringify({ error: 'invalid payload' }));
            return;
          }
          if (payload.sync) applySync(payload.sync, payload.client);
          const entry = pending.get(payload.id);
          if (entry) {
            clearTimeout(entry.timer);
            pending.delete(payload.id);
            if (payload.ok) entry.resolve(payload.result);
            else entry.reject(new McpToolError(payload.error ?? 'Bridge command failed'));
          }
          // Acknowledge syncs so the browser can report "connected" only once the
          // relay has registered its state.
          response.writeHead(200, { 'content-type': 'application/json', ...cors });
          response.end(JSON.stringify({ ok: true, revision, ready: payload.sync !== undefined }));
        })
        .catch(() => {
          response.writeHead(400, { 'content-type': 'application/json', ...cors });
          response.end(JSON.stringify({ error: 'invalid payload' }));
        });
      return true;
    }

    if (url.pathname === '/bridge/status' && request.method === 'GET') {
      // Aggregate only: whether an editor is connected, plus counters.
      response.writeHead(200, { 'content-type': 'application/json', ...cors });
      response.end(
        JSON.stringify({
          connected: active !== null,
          client: active?.name ?? null,
          connections: connections.size,
          commands,
          revision,
        }),
      );
      return true;
    }

    return false;
  };

  return {
    token,
    session: remote,
    handle: handleRequest,
    status: () => ({
      connected: active !== null,
      client: active?.name ?? null,
      connections: connections.size,
      commands,
      revision,
    }),
    close: () => {
      for (const connection of connections) connection.res.end();
      connections.clear();
      active = null;
      failPending(noEditor());
      return Promise.resolve();
    },
  };
}

/** The bridge on its own listener (the CLI's `--bridge`, and the desktop app). */
export async function startRelayServer(options: RelayOptions = {}): Promise<RelayHandle> {
  const host = options.host ?? '127.0.0.1';
  const bridge = createBridge(options);
  const handle = createServer((request, response) => {
    if (bridge.handle(request, response)) return;
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'not found' }));
  });

  await new Promise<void>((resolve) => handle.listen(options.port ?? 0, host, resolve));
  const address = handle.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    url: `http://${host}:${port}`,
    token: bridge.token,
    session: bridge.session,
    handle: bridge.handle,
    status: bridge.status,
    close: async () => {
      await bridge.close();
      await new Promise<void>((resolve, reject) => handle.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

export type { DocumentSession };
