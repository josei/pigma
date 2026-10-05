/**
 * Deployment wiring, as a function.
 *
 * `server/index.ts` is the CLI wrapper (flags, banner, signals); everything it
 * actually starts lives here, so a test can drive a whole deployment
 * **in-process** instead of spawning one — a spawned `vite-node` costs seconds
 * under load, which is exactly the kind of timing a unit test should not depend
 * on. The CLI keeps using this same function, so there is one wiring path.
 */
import { existsSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createCollabServer, type CollabServer } from '../src/collab/server';
import { resolveLimits, type RelayLimits } from '../src/collab/limits';
import { createMcpServer } from '../src/mcp/protocol';
import { createSession } from '../src/mcp/session';
import { nodeRasterizer } from '../src/mcp/raster.node';
import { createNodePluginInterpreter } from '../src/mcp/plugin/interpreter.node';
import { TokenStore } from '../src/mcp/tokens';
import { createHttpHandler } from '../src/mcp/transports/http';
import { toNodeHandler } from '../src/mcp/transports/node';
import { createBridge, type BridgeHandle } from '../src/mcp/relay';
import { DEFAULT_ALLOWED_HOSTS, DEFAULT_ORIGINS } from '../src/mcp/origins';
import { CONFIG_PATH, buildConfig, serializeConfig, type DeploymentConfig } from './config';

export interface DeploymentOptions {
  /** Requested port; `0` asks the OS for a free one. */
  port: number;
  host: string;
  /**
   * The address users reach this deployment on when it is behind a proxy or
   * tunnel. When set, the advertised MCP and relay URLs use it and its host is
   * allowed through the MCP endpoint's host check; when absent both fall back to
   * the bind address, which is correct on loopback and wrong in public.
   */
  publicUrl?: string;
  /** Built assets to serve; omitted serves the relay only. */
  staticDir?: string;
  /** Snapshot directory; omitted keeps snapshots in memory. */
  dataDir?: string;
  /** Room token required on the WebSocket URL. */
  token?: string;
  limits?: Partial<RelayLimits>;
  /** Serve the MCP endpoint (hosted deployments set this too). */
  mcp: boolean;
  mcpPath: string;
  /** A fixed MCP token (self-host). Hosted mints per-session tokens instead. */
  mcpToken?: string;
  tokenTtlMs?: number;
  /** Mount the editor bridge (hosted): how MCP reaches a live document. */
  bridge: boolean;
  bridgePath: string;
  bridgeToken?: string;
  /** Loader for the plugin interpreter; tests may inject one. */
  interpreter?: Parameters<typeof createMcpServer>[0]['interpreter'];
}

export interface Deployment {
  port: number;
  httpBase: string;
  /** The advertised config, exactly as `GET /config.json` serves it. */
  config: DeploymentConfig;
  configJson: string;
  /** The bridge token, when the bridge is mounted. Never advertised. */
  bridgeToken?: string;
  bridge: BridgeHandle | undefined;
  server: CollabServer;
  limits: RelayLimits;
  close(): Promise<void>;
}

export async function startDeployment(options: DeploymentOptions): Promise<Deployment> {
  const hasStatic = options.staticDir !== undefined && existsSync(options.staticDir);
  const limits = resolveLimits(options.limits);

  // Hosted: per-session tokens (mint/TTL/revoke). Self-host with a fixed token:
  // that value is the token. Either way it is never advertised in the config.
  let mcpTokens: TokenStore | undefined;
  if (options.mcp) {
    if (options.bridge) {
      // Hosted: per-session tokens, minted on demand, short-lived, revocable.
      mcpTokens = new TokenStore(options.tokenTtlMs === undefined ? {} : { ttlMs: options.tokenTtlMs });
    } else if (options.mcpToken !== undefined) {
      // Self-host with a fixed token: this value is the token.
      mcpTokens = new TokenStore();
      mcpTokens.adopt(options.mcpToken);
    }
    // `--mcp` with no token serves an open endpoint.
  }

  // The bridge is how a hosted MCP call reaches the user's live document. Its
  // token is a deployment secret: printed for the operator, never advertised.
  // The bridge's HOST allowlist follows the same rule as the MCP one: a hosted
  // deployment adds its public host so the EDITOR can connect over the tunnel.
  // The bridge's TOKEN gate is unchanged and still required — this widens
  // reachability, not access.
  const publicOrigin = normalizeOrigin(options.publicUrl);
  const publicHost = publicOrigin ? new URL(publicOrigin).hostname : null;
  const bridge = options.bridge
    ? createBridge({
        ...(options.bridgeToken ? { token: options.bridgeToken } : {}),
        ...(publicHost ? { allowedHosts: [publicHost, ...DEFAULT_ALLOWED_HOSTS] } : {}),
        // The bridge's ORIGIN allowlist follows the same rule. Without it the SSE
        // connect (a GET, no Origin) opened and every PUSH (a POST, with Origin)
        // was refused — the same asymmetry as the MCP handler, one allowlist over.
        ...(publicOrigin ? { allowedOrigins: [publicOrigin, ...DEFAULT_ORIGINS] } : {}),
      })
    : undefined;

  let nodeMcpHandler: ((request: IncomingMessage, response: ServerResponse) => void) | undefined;
  let configJson = '';

  /** Routes this deployment adds to the relay's own: the config surface and MCP. */
  const handleExtra = (request: IncomingMessage, response: ServerResponse): boolean => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (path === CONFIG_PATH && (request.method === 'GET' || request.method === 'HEAD')) {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : configJson);
      return true;
    }
    if (nodeMcpHandler && (path === options.mcpPath || path.startsWith(`${options.mcpPath}/`))) {
      nodeMcpHandler(request, response);
      return true;
    }
    if (bridge?.handle(request, response)) return true;
    return false;
  };

  const server = createCollabServer({
    ...(hasStatic ? { staticDir: options.staticDir } : {}),
    ...(options.dataDir ? { dataDir: options.dataDir } : {}),
    ...(options.token ? { token: options.token } : {}),
    // The relay gets the SAME two allowlists as the MCP endpoint and the bridge,
    // from the same shared defaults and the same --public-url. The room key stays
    // the boundary; this only stops a page the user did not choose from opening a
    // socket at all.
    ...(publicOrigin
      ? {
          allowedHosts: [publicHost as string, ...DEFAULT_ALLOWED_HOSTS],
          allowedOrigins: [publicOrigin, ...DEFAULT_ORIGINS],
        }
      : {}),
    limits,
    handle: handleExtra,
  });

  const { port } = await server.listen(options.port, options.host);

  // The real address is only known now (the port may have been 0): build the
  // advertised URLs and the MCP endpoint.
  //
  // A deployment behind a proxy or tunnel must advertise the address users
  // actually reach, not the address it bound. Deriving both from the bind
  // address is correct on loopback and wrong in public in TWO ways at once: the
  // advertised endpoint is unreachable, and the MCP host allowlist — loopback by
  // default — rejects the real Host with a 403 that names the host it refused.
  const reachable = options.host === '0.0.0.0' || options.host === '::' ? '127.0.0.1' : options.host;
  const httpBase = publicOrigin ?? `http://${reachable}:${port}`;
  const mcpUrl = `${httpBase}${options.mcpPath}`;
  if (options.mcp) {
    const handler = createHttpHandler(
      createMcpServer({
        // Hosted: the bridge session, so tools act on the editor's live document.
        // Otherwise an in-memory document. Neither is ever persisted — the MCP
        // path writes nothing to disk (see docs/MCP.md, "no log, no store").
        session: bridge ? bridge.session : createSession(null),
        rasterizer: nodeRasterizer,
        interpreter: options.interpreter ?? createNodePluginInterpreter(),
      }),
      {
        endpoint: mcpUrl,
        state: options.bridge ? 'hosted' : 'self-hosted',
        ...(mcpTokens ? { tokens: mcpTokens } : {}),
        // BOTH allowlists follow the same rule. Passing only `allowedHosts` left
        // the ORIGIN allowlist at its loopback default, so a browser sitting ON
        // the public origin was refused (403 with an Origin header, 201 without) —
        // which is why curl probes passed while the panel could not mint a token.
        // The origin gate is CSRF protection; for a browser SERVED BY that origin
        // the correct answer is to allow that origin, not to remove the gate.
        ...(publicOrigin
          ? {
              allowedHosts: [new URL(publicOrigin).hostname, ...DEFAULT_ALLOWED_HOSTS],
              allowedOrigins: [publicOrigin, ...DEFAULT_ORIGINS],
            }
          : {}),
      },
    );
    nodeMcpHandler = toNodeHandler(handler);
  }

  const config = buildConfig({
    relayUrl: `${httpBase.replace(/^http/, 'ws')}/collab`,
    relayTokenRequired: options.token !== undefined,
    ...(options.mcp ? { mcpUrl } : {}),
    mcpTokenRequired: mcpTokens !== undefined,
    // The same binary still speaks stdio when started without --http.
    stdioAvailable: true,
    bridgeEnabled: bridge !== undefined,
    bridgePath: options.bridgePath,
  });
  configJson = serializeConfig(config);

  return {
    port,
    httpBase,
    config,
    configJson,
    ...(bridge ? { bridgeToken: bridge.token } : {}),
    bridge,
    server,
    limits,
    close: async () => {
      await bridge?.close();
      await server.close();
    },
  };
}

/**
 * An origin (`scheme://host[:port]`) with any path, query or trailing slash
 * stripped, or `undefined` when the value is not an absolute http(s) URL. A
 * deployment's advertised base is an origin, not a page.
 */
function normalizeOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return `${url.protocol}//${url.host}`;
  } catch {
    return undefined;
  }
}
