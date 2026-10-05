/**
 * Where MCP is offered (product decision in docs/ROADMAP.md).
 *
 * MCP is offered in three places, and they differ only in the endpoint and in
 * whether a token is required:
 *
 *   hosted      getpigma.com's own MCP endpoint, reached through the relay, with
 *               a per-session token minted by `POST /mcp/token`
 *   desktop     the shell's `desktop_info` loopback endpoint — no token
 *   self-hosted a server's advertised endpoint (`/config.json`, see
 *               server/config.ts), or the user's own — token when it asks for one
 *
 * The advertised payload never contains a secret (server/config.ts), so a token
 * comes from the desktop shell, from a hosted mint, or from the user, never from
 * the advertisement.
 */
import { HOSTED_MCP_ENDPOINT, effectiveMcpEndpoint, normalizeEndpoint, type EndpointOverrides } from './endpoints';

/**
 * The well-known path a deployment advertises on. Mirrors `CONFIG_PATH` in
 * server/config.ts — the client does not import server code, and
 * src/config/mcpAvailability.test.ts pins the two together.
 */
export const MCP_CONFIG_PATH = '/config.json';

/** The part of the advertised config this module reads. */
export interface McpAdvertisement {
  endpoint: string;
  /** How the deployment is reached: loopback (this machine) or a server. */
  mode: 'loopback' | 'server';
  /** Whether the endpoint needs a session token. Never the token itself. */
  tokenRequired: boolean;
  /**
   * Base URL of the editor bridge this deployment mounts (no trailing path):
   * the panel points its bridge controls at it, so a hosted deployment works
   * without the user typing anything. Null when the deployment mounts none.
   */
  bridgeBase: string | null;
}

/**
 * What the Tauri shell reports (`desktop_info`, see docs/DESKTOP.md).
 *
 * The field names are the wire contract: the shell's `DesktopInfo` struct
 * carries `#[serde(rename_all = "camelCase")]`, pinned by the Rust test
 * `desktop_info_serializes_camel_case` (`src-tauri/src/main.rs`).
 */
export interface DesktopInfo {
  mcpEndpoint?: unknown;
  mcpTokenRequired?: unknown;
}

export type McpAvailability =
  | { kind: 'hosted'; endpoint: string; token: string | null; tokenRequired: boolean }
  | { kind: 'desktop'; endpoint: string; token: string | null; tokenRequired: boolean }
  | { kind: 'self-hosted'; endpoint: string; token: string | null; tokenRequired: boolean };

export interface McpEnvironment {
  /** The desktop shell's loopback endpoint, when this is the desktop app. */
  desktop: McpAdvertisement | null;
  /** What this page's own server advertised at {@link MCP_CONFIG_PATH}. */
  advertised: McpAdvertisement | null;
  /** The endpoint the user remembered/typed; it always wins. */
  overrides?: EndpointOverrides;
  /** A token the shell supplied (loopback only; never advertised). */
  desktopToken?: string | null;
}

/** Read one advertised config payload into an advertisement, or null. */
export function toAdvertisement(body: unknown): McpAdvertisement | null {
  if (!body || typeof body !== 'object') return null;
  const mcp = (body as { mcp?: unknown }).mcp;
  if (!mcp || typeof mcp !== 'object') return null;
  const record = mcp as Record<string, unknown>;
  if (record.enabled !== true) return null;
  const endpoint = normalizeEndpoint(record.url, null);
  if (endpoint === null) return null;
  const mode = (body as { mode?: unknown }).mode;
  const bridge = (body as { bridge?: unknown }).bridge;
  const bridgeRecord = bridge && typeof bridge === 'object' ? (bridge as Record<string, unknown>) : null;
  const bridgeEnabled = bridgeRecord?.enabled === true;
  let bridgeBase: string | null = null;
  if (bridgeEnabled) {
    // The advertised `path` is the prefix the bridge client appends to itself
    // (`/bridge/events`), so the panel's field takes the origin only.
    try {
      bridgeBase = new URL(endpoint).origin;
    } catch {
      bridgeBase = null;
    }
  }
  return {
    endpoint,
    mode: mode === 'loopback' ? 'loopback' : 'server',
    tokenRequired: record.tokenRequired === true,
    bridgeBase,
  };
}

/**
 * Decide which state the panel is in. Precedence: the user's own endpoint, then
 * the desktop shell, then the server's advertisement. The desktop state is the
 * shell's own report (`desktop_info`); anything a *server* advertises is a
 * self-host, even when that server happens to run on this machine.
 */
export function resolveMcpAvailability(environment: McpEnvironment): McpAvailability {
  // Only a *typed* endpoint is an override. The hosted default is not: it is the
  // hosted state, which is a different thing from the user pointing elsewhere.
  const typed = environment.overrides?.mcp?.trim() ?? '';
  const override = typed === '' ? null : effectiveMcpEndpoint({ mcp: typed });
  if (override !== null) {
    // A typed endpoint carries no advertised token requirement: the user knows
    // what their own server asks for, and the panel still shows any token it has.
    return { kind: 'self-hosted', endpoint: override, token: environment.desktopToken ?? null, tokenRequired: false };
  }
  if (environment.desktop) {
    return {
      kind: 'desktop',
      endpoint: environment.desktop.endpoint,
      token: environment.desktopToken ?? null,
      tokenRequired: environment.desktop.tokenRequired,
    };
  }
  if (environment.advertised) {
    return {
      kind: 'self-hosted',
      endpoint: environment.advertised.endpoint,
      token: environment.desktopToken ?? null,
      tokenRequired: environment.advertised.tokenRequired,
    };
  }
  // Nothing local or advertised: the hosted endpoint, which needs a session
  // token. This is the "no download needed" path.
  return {
    kind: 'hosted',
    endpoint: HOSTED_MCP_ENDPOINT,
    token: environment.desktopToken ?? null,
    tokenRequired: true,
  };
}

/** Every state offers a connection; they differ in endpoint and token only. */
export function offersMcp(availability: McpAvailability): boolean {
  return availability.endpoint.trim() !== '';
}

/**
 * The Tauri shell's report, when the app runs inside it. The command is exposed
 * by the shell (`desktop_info`); a browser has no `__TAURI__`, so this returns
 * null there without touching the network.
 */
export async function readDesktopInfo(): Promise<{ advertisement: McpAdvertisement; token: string | null } | null> {
  if (typeof window === 'undefined') return null;
  const tauri = (window as unknown as { __TAURI__?: { invoke?: unknown; core?: { invoke?: unknown } } }).__TAURI__;
  const invoke = (tauri?.core?.invoke ?? tauri?.invoke) as ((command: string) => Promise<unknown>) | undefined;
  if (typeof invoke !== 'function') return null;
  try {
    const info = (await invoke('desktop_info')) as DesktopInfo | null;
    const endpoint = normalizeEndpoint(info?.mcpEndpoint, null);
    if (endpoint === null) return null;
    // The shell's loopback server needs no token (the CLI's loopback default);
    // the shell reports whether one *would* be required instead of sending one.
    return {
      advertisement: { endpoint, mode: 'loopback', tokenRequired: info?.mcpTokenRequired === true, bridgeBase: null },
      token: null,
    };
  } catch {
    // A shell that does not answer simply means no desktop endpoint: the panel
    // falls back to the advertised or hosted state rather than failing.
    return null;
  }
}

/**
 * What the page's own server advertises. A static host (the hosted site) has no
 * `/config.json`, which is the hosted state.
 */
export async function readAdvertisedMcp(fetchImpl?: typeof fetch): Promise<McpAdvertisement | null> {
  const doFetch = fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) return null;
  try {
    const response = await doFetch(MCP_CONFIG_PATH, { headers: { accept: 'application/json' } });
    if (!response.ok) return null;
    return toAdvertisement(await response.json());
  } catch {
    return null;
  }
}

/** Read both sources. Each is optional; a failure is simply "not offered". */
export async function readMcpEnvironment(): Promise<{
  desktop: McpAdvertisement | null;
  advertised: McpAdvertisement | null;
  desktopToken: string | null;
}> {
  const [desktop, advertised] = await Promise.all([readDesktopInfo(), readAdvertisedMcp()]);
  return { desktop: desktop?.advertisement ?? null, advertised, desktopToken: desktop?.token ?? null };
}
