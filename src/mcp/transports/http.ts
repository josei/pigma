/**
 * Streamable HTTP transport.
 *
 * `POST /mcp` accepts a JSON-RPC message (or batch) and answers with either
 * `application/json` or a single-message `text/event-stream`, chosen from the
 * client's `Accept` header. `GET /mcp` returns 405: this server never initiates
 * a stream. `DELETE /mcp` acknowledges session termination (sessions are
 * implicit).
 *
 * Two more paths exist for the MCP panel:
 *  - `GET /mcp/status` — health and status, including the harness config
 *    snippets. Never carries a raw token.
 *  - `POST /mcp/token` / `DELETE /mcp/token` — mint and revoke a session token
 *    (hosted mode only). Minting is allowed from the loopback peer, or with the
 *    operator's mint secret when one is configured.
 *
 * Security is host/origin based plus, when hosted mode is enabled, a capability
 * token — never client-identity based:
 *  - `Host` must be a configured host (DNS-rebinding protection);
 *  - a present `Origin` must be explicitly allowed;
 *  - no permissive `Access-Control-Allow-Origin: *`;
 *  - with a token store wired in, every JSON-RPC request needs a live session
 *    token (`Authorization: Bearer …` or `X-Pigma-Token: …`).
 *
 * There is deliberately **no client allowlist**: any MCP client may connect.
 */
import type { JsonRpcMessage, JsonRpcResponse } from '../types';
import { DEFAULT_ALLOWED_HOSTS, DEFAULT_ORIGINS, hostAllowed, originAllowed } from '../origins';
import { ErrorCode } from '../types';
import type { McpServer } from '../protocol';
import { harnessConfigs, type HarnessConfigEntry } from '../harnessConfig';
import type { SessionSummary, TokenStore } from '../tokens';
import { toolCount, type McpStateKind } from '../toolCatalog';

export interface HttpTransportOptions {
  /** Host header values accepted (hostname, optional `:port`). Default: loopback. */
  allowedHosts?: string[];
  /** Origin values allowed for browser clients. Default: loopback origins. */
  allowedOrigins?: string[];
  /**
   * Session tokens. When omitted the endpoint requires no token at all
   * (loopback and self-host defaults); when present, every JSON-RPC request
   * must carry a live token.
   */
  tokens?: TokenStore;
  /** Endpoint advertised in the status surface and the harness config. Default `http://localhost/mcp`. */
  endpoint?: string;
  /** Server name used as the harness config key. Default `pigma`. */
  name?: string;
  /**
   * Operator secret that allows minting a token from a non-loopback peer.
   * Without it, minting is loopback-only.
   */
  mintSecret?: string;
  /** How the endpoint is reached. Default is derived from the endpoint host. */
  mode?: 'loopback' | 'server' | 'hosted';
  /**
   * Which state this endpoint serves. Reported as-is, and used to keep the
   * advertised tool count honest (`toolCount` comes from the server's registry).
   */
  state?: McpStateKind;
}

/** The status surface payload (`GET /mcp/status`). */
export interface HttpStatusPayload {
  ok: true;
  transport: 'streamable-http';
  endpoint: string;
  mode: 'loopback' | 'server' | 'hosted';
  /** The state this endpoint serves: hosted, desktop or self-hosted. */
  state: McpStateKind;
  /**
   * How many tools this endpoint advertises, read from its registry — never a
   * constant, so a panel showing it cannot disagree with what clients receive.
   */
  toolCount: number;
  tokenRequired: boolean;
  tokenTtlMs: number | null;
  /** Masked session list; raw tokens are never included. */
  sessions: SessionSummary[];
  harnessConfig: HarnessConfigEntry[];
}

const LOOPBACK_PEERS = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
/** Host names that mean loopback when they appear in the endpoint. */
const LOOPBACK_HOSTS = [...LOOPBACK_PEERS, 'localhost'];

function isLoopbackPeer(value: string | null): boolean {
  if (!value) return false;
  const address = value.replace(/^\[|\]$/g, '').split('%')[0] as string;
  return LOOPBACK_PEERS.includes(address);
}

function endpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).hostname;
  } catch {
    return 'localhost';
  }
}

/**
 * How the endpoint is reached. A loopback endpoint is the desktop/`pigma mcp`
 * case whatever the token policy; a non-loopback endpoint is a self-host
 * (`server`) unless session tokens are required, which is the hosted case.
 */
function derivedMode(endpoint: string, tokenRequired: boolean): 'loopback' | 'server' | 'hosted' {
  if (LOOPBACK_HOSTS.includes(endpointHost(endpoint))) return 'loopback';
  return tokenRequired ? 'hosted' : 'server';
}

/** Read the capability token from either accepted header. */
function requestToken(request: Request): string | null {
  const authorization = request.headers.get('authorization');
  if (authorization) {
    const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
    if (match) return match[1] as string;
  }
  const direct = request.headers.get('x-pigma-token');
  return direct && direct.trim().length > 0 ? direct.trim() : null;
}

/**
 * The hosts the MCP endpoint accepts when the caller supplies no allowlist:
 * loopback only. A deployment that is reachable on a public address MUST pass
 * its own host (see `server/deployment.ts`) or every request is refused with a
 * 403 naming the host it would not accept — including the URL it advertises.
 */

export { DEFAULT_ORIGINS, DEFAULT_ALLOWED_HOSTS } from '../origins';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function corsHeaders(origin: string | null, allowedOrigins: string[]): Record<string, string> {
  if (!origin || !originAllowed(origin, allowedOrigins)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID',
    'Access-Control-Expose-Headers': 'MCP-Session-Id',
  };
}

function sseResponse(responses: JsonRpcResponse[], headers: Record<string, string>): Response {
  const body = responses.map((response) => `event: message\ndata: ${JSON.stringify(response)}\n\n`).join('');
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', ...headers },
  });
}

/** Build a fetch-style handler for the server. */
export function createHttpHandler(
  server: McpServer,
  options: HttpTransportOptions = {},
): (request: Request) => Promise<Response> {
  const allowedHosts = options.allowedHosts ?? DEFAULT_ALLOWED_HOSTS;
  const allowedOrigins = options.allowedOrigins ?? DEFAULT_ORIGINS;
  const endpoint = options.endpoint ?? 'http://localhost/mcp';
  const name = options.name ?? 'pigma';
  const tokens = options.tokens;
  const mode = options.mode ?? derivedMode(endpoint, Boolean(tokens));
  const state: McpStateKind = options.state ?? (mode === 'hosted' ? 'hosted' : mode === 'loopback' ? 'desktop' : 'self-hosted');

  const status = (): HttpStatusPayload => ({
    ok: true,
    transport: 'streamable-http',
    endpoint,
    mode,
    state,
    // Derived from the live registry, so it always matches `tools/list`.
    toolCount: toolCount(server.tools),
    tokenRequired: Boolean(tokens),
    tokenTtlMs: tokens?.lifetimeMs ?? null,
    sessions: tokens?.sessions() ?? [],
    harnessConfig: harnessConfigs({ endpoint, name }),
  });

  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin');
    const host = request.headers.get('host');

    if (!hostAllowed(host, allowedHosts)) {
      return jsonResponse({ jsonrpc: '2.0', id: null, error: { code: ErrorCode.INVALID_REQUEST, message: `Host "${host}" is not allowed` } }, 403);
    }
    if (!originAllowed(origin, allowedOrigins)) {
      return jsonResponse({ jsonrpc: '2.0', id: null, error: { code: ErrorCode.INVALID_REQUEST, message: `Origin "${origin}" is not allowed` } }, 403);
    }
    const cors = corsHeaders(origin, allowedOrigins);
    const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    // Health/status is deliberately reachable without a token: it is how a
    // panel or an operator checks the endpoint, and it never leaks a token.
    if (path === '/mcp/status' && request.method === 'GET') {
      return jsonResponse(status(), 200, cors);
    }

    if (path === '/mcp/token') {
      if (!tokens) {
        return jsonResponse({ error: 'This endpoint is not in hosted mode; it requires no token.' }, 404, cors);
      }
      if (request.method === 'POST') {
        // Minting is loopback-only unless the operator configured a mint secret.
        const peer = request.headers.get('x-pigma-peer');
        const mint = request.headers.get('x-pigma-mint');
        const allowed = isLoopbackPeer(peer) || (options.mintSecret !== undefined && mint === options.mintSecret);
        if (!allowed) {
          return jsonResponse({ error: 'Minting a session token requires a loopback request or the mint secret.' }, 403, cors);
        }
        const session = tokens.mint(null);
        // The only response that ever contains the raw token.
        return jsonResponse(
          {
            token: session.token,
            sessionId: session.sessionId,
            createdAt: session.createdAt,
            expiresAt: session.expiresAt,
            ttlMs: tokens.lifetimeMs,
            harnessConfig: harnessConfigs({ endpoint, name, token: session.token }),
          },
          201,
          cors,
        );
      }
      if (request.method === 'DELETE') {
        const token = requestToken(request);
        const revoked = tokens.revoke(token);
        return jsonResponse({ revoked }, revoked ? 200 : 404, cors);
      }
      return jsonResponse({ error: 'Method not allowed' }, 405, cors);
    }

    // Everything else is JSON-RPC, gated by a live token when hosted.
    if (tokens) {
      const verification = tokens.verify(requestToken(request));
      if (!verification.ok) {
        return jsonResponse(
          {
            jsonrpc: '2.0',
            id: null,
            error: { code: ErrorCode.INVALID_REQUEST, message: `MCP session token rejected (${verification.reason})` },
          },
          401,
          { ...cors, 'www-authenticate': `Bearer realm="${name}"` },
        );
      }
    }

    if (request.method === 'GET') {
      return jsonResponse(
        { jsonrpc: '2.0', id: null, error: { code: ErrorCode.INVALID_REQUEST, message: 'This server does not offer a server-initiated stream' } },
        405,
        cors,
      );
    }
    if (request.method === 'DELETE') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== 'POST') {
      return jsonResponse({ jsonrpc: '2.0', id: null, error: { code: ErrorCode.INVALID_REQUEST, message: 'Method not allowed' } }, 405, cors);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await request.text());
    } catch {
      return jsonResponse({ jsonrpc: '2.0', id: null, error: { code: ErrorCode.PARSE_ERROR, message: 'Parse error' } }, 400, cors);
    }

    const messages: JsonRpcMessage[] = Array.isArray(parsed) ? (parsed as JsonRpcMessage[]) : [parsed as JsonRpcMessage];
    const responses: JsonRpcResponse[] = [];
    for (const message of messages) {
      const response = await server.handle(message);
      if (response) responses.push(response);
    }

    if (responses.length === 0) return new Response(null, { status: 202, headers: cors });
    const accept = request.headers.get('accept') ?? '';
    if (accept.includes('text/event-stream') && !accept.includes('application/json')) {
      return sseResponse(responses, cors);
    }
    return jsonResponse(Array.isArray(parsed) ? responses : responses[0], 200, cors);
  };
}
