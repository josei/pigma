/**
 * Hosted endpoints (product decision in docs/ROADMAP.md).
 *
 * getpigma.com hosts the **relay** and, since the 2026-10-03 decision, a
 * **fully working MCP endpoint** served by it: Claude/ChatGPT can drive Pigma
 * with no download. The relay necessarily sees tool calls — accepted, under a
 * hard policy that it logs nothing and stores nothing of MCP traffic. The
 * desktop app (loopback) and a self-hosted server remain available for users who
 * want the endpoint on their own machine.
 *
 * Nothing connects until the user joins a room or connects MCP.
 */

export const HOSTED_RELAY_URL = 'wss://getpigma.com/relay';
/** The hosted MCP endpoint: served by the relay, tokens minted per session. */
export const HOSTED_MCP_ENDPOINT = 'https://getpigma.com/mcp';

/** Where a user's overrides are remembered (per browser, no account). */
export const ENDPOINT_OVERRIDE_KEY = 'pigma:endpoints:v1';

export interface EndpointOverrides {
  relay?: string;
  mcp?: string;
}

/** Trim an override; an empty or malformed value falls back to the default. */
export function normalizeEndpoint(value: unknown, fallback: string | null): string | null {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (trimmed === '') return fallback;
  // Accept scheme://host[/path] with an optional port; reject anything with spaces.
  if (/\s/.test(trimmed)) return fallback;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return fallback;
  return trimmed;
}

/** The relay URL to use: the override when there is one, else the hosted default. */
export function effectiveRelayUrl(overrides: EndpointOverrides = {}): string {
  // The relay always has a default, so this never returns null.
  return normalizeEndpoint(overrides.relay, HOSTED_RELAY_URL) ?? HOSTED_RELAY_URL;
}

/**
 * The MCP endpoint to use: the user's override when there is one, else the
 * hosted default — which is `null`, because the hosted site does not offer MCP.
 */
export function effectiveMcpEndpoint(overrides: EndpointOverrides = {}): string | null {
  return normalizeEndpoint(overrides.mcp, HOSTED_MCP_ENDPOINT);
}

/** True when an endpoint points at this machine (the desktop/self-host case). */
export function isLoopbackEndpoint(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
  } catch {
    return false;
  }
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Read the remembered overrides; anything malformed is ignored. */
export function readEndpointOverrides(): EndpointOverrides {
  const store = storage();
  if (!store) return {};
  try {
    const raw = store.getItem(ENDPOINT_OVERRIDE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const record = parsed as Record<string, unknown>;
    const overrides: EndpointOverrides = {};
    if (typeof record.relay === 'string' && record.relay.trim() !== '') overrides.relay = record.relay.trim();
    if (typeof record.mcp === 'string' && record.mcp.trim() !== '') overrides.mcp = record.mcp.trim();
    return overrides;
  } catch {
    return {};
  }
}

/** Remember (or clear, with an empty value) an override. */
export function saveEndpointOverrides(patch: EndpointOverrides): EndpointOverrides {
  const next: EndpointOverrides = { ...readEndpointOverrides() };
  for (const key of ['relay', 'mcp'] as const) {
    const value = patch[key];
    if (value === undefined) continue;
    const trimmed = value.trim();
    if (trimmed === '') delete next[key];
    else next[key] = trimmed;
  }
  const store = storage();
  try {
    if (Object.keys(next).length === 0) store?.removeItem(ENDPOINT_OVERRIDE_KEY);
    else store?.setItem(ENDPOINT_OVERRIDE_KEY, JSON.stringify(next));
  } catch {
    // A blocked localStorage only costs the remembered override.
  }
  return next;
}
