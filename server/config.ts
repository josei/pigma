/**
 * The deployment config surface: `GET /config.json`.
 *
 * A self-hosted Pigma advertises what it offers so the app can enable the MCP
 * panel without the operator pasting URLs. The same shape serves the desktop
 * build's `desktop_info` facts (loopback endpoint + bundled relay), so the panel
 * has one contract to read.
 *
 * **No secrets.** A token is reported as `tokenRequired: true` and nothing else —
 * the value never appears here (the bridge token included), and neither does any
 * document, room key, or MCP payload.
 * Anything that could not be advertised safely (a token, a key, a snapshot) must
 * never be added to this object.
 */

export const CONFIG_PATH = '/config.json';
export const CONFIG_SCHEMA = 'pigma/config/1';

export interface McpConfig {
  /** Whether this deployment serves an MCP endpoint at all. */
  enabled: boolean;
  /** Absolute endpoint URL, present only when enabled. */
  url?: string;
  /** Whether requests need a session token. Never the token itself. */
  tokenRequired: boolean;
  /** Whether the same endpoint is reachable over stdio (`--stdio`). */
  stdioAvailable: boolean;
}

export interface BridgeConfig {
  /** Whether this deployment mounts the editor bridge (how MCP reaches a live document). */
  enabled: boolean;
  /** Path prefix of the bridge routes. Never the bridge token. */
  path: string;
}

export interface RelayConfig {
  /** WebSocket URL clients join rooms on. */
  url: string;
  /** Whether rooms need a token. Never the token itself. */
  tokenRequired: boolean;
  /** End-to-end encryption is a client-side property; the relay stores ciphertext. */
  e2e: true;
}

export interface DeploymentConfig {
  schema: typeof CONFIG_SCHEMA;
  name: string;
  version: string;
  /** How this deployment is reached: loopback (desktop/`pigma mcp`) or a server. */
  mode: 'loopback' | 'server';
  mcp: McpConfig;
  bridge: BridgeConfig;
  relay: RelayConfig;
}

export interface ConfigInput {
  name?: string;
  version?: string;
  /** Advertised MCP endpoint, or omitted when MCP is disabled. */
  mcpUrl?: string;
  /** True when the endpoint requires a session token. */
  mcpTokenRequired?: boolean;
  /** True when the same MCP server is also reachable over stdio. */
  stdioAvailable?: boolean;
  /** True when the editor bridge is mounted (hosted deployments). */
  bridgeEnabled?: boolean;
  /** Bridge path prefix. The bridge token is never part of the config. */
  bridgePath?: string;
  relayUrl: string;
  relayTokenRequired?: boolean;
}

function isLoopback(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

/** Build the advertised config. Pure, so the shape and the no-secrets rule are testable. */
export function buildConfig(input: ConfigInput): DeploymentConfig {
  const mcpEnabled = typeof input.mcpUrl === 'string' && input.mcpUrl.length > 0;
  return {
    schema: CONFIG_SCHEMA,
    name: input.name ?? 'pigma',
    version: input.version ?? '0.1.0',
    mode: isLoopback(mcpEnabled ? (input.mcpUrl as string) : input.relayUrl) ? 'loopback' : 'server',
    mcp: {
      enabled: mcpEnabled,
      ...(mcpEnabled ? { url: input.mcpUrl as string } : {}),
      tokenRequired: mcpEnabled ? input.mcpTokenRequired === true : false,
      stdioAvailable: input.stdioAvailable === true,
    },
    bridge: {
      enabled: input.bridgeEnabled === true,
      path: input.bridgePath ?? '/bridge',
    },
    relay: {
      url: input.relayUrl,
      tokenRequired: input.relayTokenRequired === true,
      e2e: true,
    },
  };
}

/** The config as JSON, with a stable key order for diffing and tests. */
export function serializeConfig(config: DeploymentConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

/**
 * Guard used by tests and by review: no value in the config may look like a
 * secret. Kept next to the shape so the invariant is impossible to forget.
 */
export function containsSecret(config: DeploymentConfig, secret: string): boolean {
  return secret.length > 0 && JSON.stringify(config).includes(secret);
}
