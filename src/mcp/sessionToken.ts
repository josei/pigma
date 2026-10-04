/**
 * Hosted MCP: the per-session token.
 *
 * getpigma.com's MCP endpoint requires a token, and the relay mints one for the
 * session with `POST /mcp/token` (see src/mcp/transports/http.ts). The token is
 * short-lived, revocable, and exists only in this tab's memory: it is never
 * written to storage, never put in a URL, and never logged. The panel shows it
 * masked and the harness config carries it, which is the only reason it exists.
 */
import { HOSTED_MCP_ENDPOINT } from '../config/endpoints';

export interface SessionToken {
  token: string;
  /** Unix milliseconds, when the deployment reported one. */
  expiresAt: number | null;
  /** Unix milliseconds when the token was minted, for the panel's "fresh" note. */
  mintedAt: number;
}

/** Where the token is minted: the endpoint's own origin, `/mcp/token`. */
export function tokenMintUrl(endpoint: string): string | null {
  try {
    const parsed = new URL(endpoint);
    return `${parsed.origin}/mcp/token`;
  } catch {
    return null;
  }
}

export interface MintResult {
  token: SessionToken | null;
  /** A message for the user when minting failed. */
  error: string | null;
}

/**
 * Ask the deployment for a session token. Failures are reported, never thrown:
 * MCP is an enhancement, and the editor keeps working without it.
 */
export async function mintSessionToken(endpoint: string, fetchImpl?: typeof fetch): Promise<MintResult> {
  const url = tokenMintUrl(endpoint);
  if (!url) return { token: null, error: 'That MCP endpoint is not a URL, so no token can be minted.' };
  const doFetch = fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) return { token: null, error: 'Could not reach the token endpoint from this page.' };

  let response: Response;
  try {
    response = await doFetch(url, {
      method: 'POST',
      headers: { accept: 'application/json' },
      // Same-origin for the hosted site; a self-host may need this too.
      credentials: 'omit',
    });
  } catch {
    return {
      token: null,
      error: 'Could not reach the token endpoint — that host does not allow the app to read it.',
    };
  }

  if (response.status === 404) {
    return { token: null, error: 'This deployment is not in hosted mode: it needs no token.' };
  }
  if (response.status === 403) {
    return {
      token: null,
      error: 'This deployment mints session tokens only for a trusted peer. Use the desktop app or self-host.',
    };
  }
  if (!response.ok) {
    return { token: null, error: `Could not mint a session token (HTTP ${response.status}).` };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { token: null, error: 'The token endpoint returned something that is not JSON.' };
  }
  const record = (body ?? {}) as Record<string, unknown>;
  const token = typeof record.token === 'string' ? record.token.trim() : '';
  if (token === '') return { token: null, error: 'The token endpoint returned no token.' };
  const expiresAt = typeof record.expiresAt === 'number' && Number.isFinite(record.expiresAt) ? record.expiresAt : null;
  return { token: { token, expiresAt, mintedAt: Date.now() }, error: null };
}

/** True when the hosted endpoint is the one in play. */
export function isHostedEndpoint(endpoint: string): boolean {
  return endpoint.replace(/\/+$/, '') === HOSTED_MCP_ENDPOINT.replace(/\/+$/, '');
}

/** How long a minted token has left, in whole minutes, or null when unknown. */
export function minutesLeft(token: SessionToken, now = Date.now()): number | null {
  if (token.expiresAt === null) return null;
  return Math.max(0, Math.round((token.expiresAt - now) / 60_000));
}
