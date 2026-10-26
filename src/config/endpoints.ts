/**
 * Endpoints for sharing rooms and the AI agent (MCP).
 *
 * There are no built-in hosted endpoints: a relay and an MCP server are run by
 * whoever runs the Pigma server (the desktop app, a self-hosted server, or a
 * developer's machine). The online copy on GitHub Pages is static and runs no
 * server, so it has none; there sharing and the agent degrade to a note that says
 * so. A user can still point the editor at their own server, which is remembered in
 * this browser (`readEndpointOverrides`).
 */

/** True for the static online copy, which has no relay or MCP server to reach. */
export const STATIC_SITE = import.meta.env.VITE_PIGMA_STATIC === '1';

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

/**
 * The relay URL to use: the user's override when there is one. Otherwise the relay
 * this page is served by (a self-hosted server serves its own), and nothing on the
 * static site, which has no relay.
 */
export function effectiveRelayUrl(overrides: EndpointOverrides = {}, pageRelay: string | null = null): string | null {
  return normalizeEndpoint(overrides.relay, pageRelay);
}

/**
 * The MCP endpoint to use: the user's override when there is one, else none. A
 * server's own advertisement (`/config.json`) is resolved by the MCP panel, not here.
 */
export function effectiveMcpEndpoint(overrides: EndpointOverrides = {}): string | null {
  return normalizeEndpoint(overrides.mcp, null);
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
