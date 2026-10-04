/**
 * Argument and environment parsing for the relay entry point.
 *
 * Flags win over the environment, so the same entry serves three cases with one
 * code path: a deployment (env only), a local relay for the editor or QA
 * (`--port`, `--host`), and a throwaway in-memory relay (`--no-data`).
 */
import { resolveLimits, type RelayLimits } from '../src/collab/limits';

export interface RelayOptions {
  /** TCP port; `0` asks the OS for a free one (useful for tests). */
  port: number;
  host: string;
  /** Optional room token required on the WebSocket URL. */
  token?: string;
  /** Snapshot directory; omitted keeps snapshots in memory only. */
  dataDir?: string;
  /** Built assets to serve; omitted serves the relay only. */
  staticDir?: string;
  limits: RelayLimits;
  /**
   * Hosted deployment: serve the app, the rooms relay, the editor bridge and a
   * token-gated MCP endpoint on one public address.
   */
  hosted: boolean;
  /** Token the editor uses to reach the bridge (hosted). Printed, never advertised. */
  bridgeToken?: string;
  /** Bridge path prefix. Default `/bridge`. */
  bridgePath: string;
  /** Serve the MCP endpoint on the same port, and advertise it in /config.json. */
  mcp: boolean;
  /** Path the MCP endpoint is mounted at. Default `/mcp`. */
  mcpPath: string;
  /** Require a session token on the MCP endpoint (never advertised as a value). */
  mcpToken?: string;
  /** Lifetime of a minted per-session token (hosted). Default 30 minutes. */
  tokenTtlMs?: number;
  /** Exit when the parent process goes away (default on; see `--no-orphan-guard`). */
  orphanGuard: boolean;
  /** `--help` was passed: print usage and exit. */
  help: boolean;
}

export const RELAY_USAGE = `Usage: vite-node server/index.ts [options]

Options:
  -p, --port <n>          listen port (default 8080; 0 picks a free port)
      --host <addr>       bind address (default 0.0.0.0; use 127.0.0.1 locally)
      --token <secret>    require this room token on the WebSocket URL
      --data-dir <path>   one snapshot file per room (default ./data)
      --no-data           keep snapshots in memory only
      --static-dir <path> built assets to serve (default ./dist)
      --no-static         serve the relay only, no static assets
      --hosted            serve the app, the rooms relay, the editor bridge and
                          a token-gated MCP endpoint on this address (implies
                          --mcp; per-session tokens are minted at POST /mcp/token)
      --bridge-token <secret>  token the editor uses for the bridge (hosted)
      --bridge-path <path>     bridge path prefix (default /bridge)
      --mcp               serve the MCP endpoint on this port too, and
                          advertise it at GET /config.json
      --mcp-path <path>   where to mount it (default /mcp)
      --mcp-token <secret>  require this session token on the MCP endpoint
      --token-ttl <ms>    lifetime of a minted per-session token (default 30m)
      --no-orphan-guard   keep running even if the parent process exits
  -h, --help              show this message

Environment (flags win): PORT, HOST, PIGMA_ROOM_TOKEN, DATA_DIR, STATIC_DIR,
PIGMA_MAX_ROOM_PEERS, PIGMA_MAX_CONNECTIONS_PER_IP,
PIGMA_CONNECTION_ATTEMPTS_PER_MINUTE, PIGMA_MESSAGES_PER_WINDOW,
PIGMA_MESSAGE_WINDOW_MS, PIGMA_ROOM_TTL_MS, PIGMA_SNAPSHOT_TTL_MS,
PIGMA_GC_INTERVAL_MS, PIGMA_HOSTED, PIGMA_MCP_ENABLED, PIGMA_MCP_PATH,
PIGMA_MCP_TOKEN, PIGMA_MCP_TOKEN_TTL_MS, PIGMA_BRIDGE_TOKEN, PIGMA_BRIDGE_PATH.

Example (a local relay for the editor or a browser test):
  vite-node server/index.ts --port 8788 --host 127.0.0.1 --no-data
`;

type Env = Record<string, string | undefined>;

/** A positive integer from the environment, ignoring nonsense. */
function envNumber(env: Env, name: string): number | undefined {
  const raw = env[name];
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** A TCP port: `0` is valid (the OS assigns one). */
function port(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535 ? parsed : undefined;
}

/** Every `PIGMA_*` capacity bound, with the environment as the only source. */
export function limitsFromEnv(env: Env): RelayLimits {
  const overrides: Partial<RelayLimits> = {};
  const bounds: Array<[keyof RelayLimits, string]> = [
    ['maxRoomPeers', 'PIGMA_MAX_ROOM_PEERS'],
    ['maxConnectionsPerIp', 'PIGMA_MAX_CONNECTIONS_PER_IP'],
    ['connectionAttemptsPerMinute', 'PIGMA_CONNECTION_ATTEMPTS_PER_MINUTE'],
    ['messagesPerWindow', 'PIGMA_MESSAGES_PER_WINDOW'],
    ['messageWindowMs', 'PIGMA_MESSAGE_WINDOW_MS'],
    ['roomTtlMs', 'PIGMA_ROOM_TTL_MS'],
    ['snapshotTtlMs', 'PIGMA_SNAPSHOT_TTL_MS'],
    ['gcIntervalMs', 'PIGMA_GC_INTERVAL_MS'],
  ];
  for (const [key, name] of bounds) {
    const value = envNumber(env, name);
    if (value !== undefined) overrides[key] = value;
  }
  return resolveLimits(overrides);
}

export function parseRelayArgs(argv: string[], env: Env = {}): RelayOptions {
  const options: RelayOptions = {
    port: port(env.PORT) ?? 8080,
    host: env.HOST?.trim() || '0.0.0.0',
    ...(env.PIGMA_ROOM_TOKEN?.trim() ? { token: env.PIGMA_ROOM_TOKEN.trim() } : {}),
    dataDir: env.DATA_DIR ?? 'data',
    staticDir: env.STATIC_DIR ?? 'dist',
    limits: limitsFromEnv(env),
    hosted: env.PIGMA_HOSTED === '1' || env.PIGMA_HOSTED === 'true',
    bridgePath: env.PIGMA_BRIDGE_PATH?.trim() || '/bridge',
    ...(env.PIGMA_BRIDGE_TOKEN?.trim() ? { bridgeToken: env.PIGMA_BRIDGE_TOKEN.trim() } : {}),
    mcp: env.PIGMA_MCP_ENABLED === '1' || env.PIGMA_MCP_ENABLED === 'true',
    mcpPath: env.PIGMA_MCP_PATH?.trim() || '/mcp',
    ...(env.PIGMA_MCP_TOKEN?.trim() ? { mcpToken: env.PIGMA_MCP_TOKEN.trim() } : {}),
    ...(envNumber(env, 'PIGMA_MCP_TOKEN_TTL_MS') ? { tokenTtlMs: envNumber(env, 'PIGMA_MCP_TOKEN_TTL_MS') as number } : {}),
    orphanGuard: true,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    const [name, inline] = arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined];
    const value = (): string | undefined => (inline !== undefined ? inline : argv[++index]);
    switch (name) {
      case '-p':
      case '--port': {
        const parsed = port(value());
        if (parsed === undefined) throw new Error('--port needs a number between 0 and 65535');
        options.port = parsed;
        break;
      }
      case '--host':
        options.host = value()?.trim() || options.host;
        break;
      case '--token':
        options.token = value();
        break;
      case '--data-dir':
        options.dataDir = value();
        break;
      case '--no-data':
        delete options.dataDir;
        break;
      case '--static-dir':
        options.staticDir = value();
        break;
      case '--no-static':
        delete options.staticDir;
        break;
      case '--hosted':
        options.hosted = true;
        options.mcp = true;
        break;
      case '--bridge-token':
        options.bridgeToken = value();
        break;
      case '--bridge-path':
        options.bridgePath = value()?.trim() || options.bridgePath;
        break;
      case '--mcp':
        options.mcp = true;
        break;
      case '--mcp-path':
        options.mcpPath = value()?.trim() || options.mcpPath;
        break;
      case '--mcp-token':
        options.mcpToken = value();
        break;
      case '--token-ttl': {
        const parsed = Number(value());
        if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('--token-ttl needs a positive number of milliseconds');
        options.tokenTtlMs = parsed;
        break;
      }
      case '--no-orphan-guard':
        options.orphanGuard = false;
        break;
      case '-h':
      case '--help':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option "${arg}"\n\n${RELAY_USAGE}`);
    }
  }
  return options;
}

/** The lines printed once the relay is listening. */
export function relayBanner(options: RelayOptions, actualPort: number, hasStatic: boolean): string[] {
  const reachable = options.host === '0.0.0.0' || options.host === '::' ? '127.0.0.1' : options.host;
  const base = `http://${reachable}:${actualPort}`;
  const ws = `ws://${reachable}:${actualPort}/collab?room=default${options.token ? `&token=${options.token}` : ''}`;
  return [
    `pigma collab relay listening on ${base}`,
    `  room endpoint: ${ws}`,
    options.token ? '  room token required' : '  no room token: anyone who can reach this port can join a room',
    hasStatic ? `  app served from ${options.staticDir}` : '  relay only (no static assets)',
    options.dataDir ? `  snapshots: ${options.dataDir} (a cache, never storage)` : '  snapshots: in memory only',
    options.mcp
      ? `  mcp: ${base}${options.mcpPath}${options.hosted ? ' (per-session tokens: POST /mcp/token)' : options.mcpToken ? ' (session token required)' : ''} · config ${base}/config.json`
      : '  mcp: not served here (start it with --mcp or --hosted, or use the desktop app’s loopback endpoint)',
    options.hosted ? `  bridge: ${base}${options.bridgePath} (editor connects with its token)` : '  bridge: not mounted',
    `  health ${base}/health · metrics ${base}/metrics`,
    `  limits: ${options.limits.maxRoomPeers}/room, ${options.limits.maxConnectionsPerIp} connections and ` +
      `${options.limits.connectionAttemptsPerMinute} upgrades/min per IP, ` +
      `${options.limits.messagesPerWindow} messages/${Math.round(options.limits.messageWindowMs / 1000)}s per IP, ` +
      `room TTL ${Math.round(options.limits.roomTtlMs / 1000)}s, snapshot TTL ${Math.round(options.limits.snapshotTtlMs / 1000)}s`,
  ];
}
