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
import { createHttpHandler, DEFAULT_ALLOWED_HOSTS } from '../src/mcp/transports/http';
import { toNodeHandler } from '../src/mcp/transports/node';
import { createBridge, type BridgeHandle } from '../src/mcp/relay';
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
  const bridge = options.bridge ? createBridge({ ...(options.bridgeToken ? { token: options.bridgeToken } : {}) }) : undefined;

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
  const publicOrigin = normalizeOrigin(options.publicUrl);
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
        ...(publicOrigin ? { allowedHosts: [new URL(publicOrigin).hostname, ...DEFAULT_ALLOWED_HOSTS] } : {}),
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
