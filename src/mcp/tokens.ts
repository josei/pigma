/**
 * Session tokens for the hosted MCP transport.
 *
 * A token is a **capability, not an identity**: it names a session, never a
 * person. There is no user record, no account, and nothing to sign in to — the
 * store below is the whole model.
 *
 * Lifecycle:
 * - **Off unless enabled.** Nothing requires a token until a store is wired into
 *   the transport (`PIGMA_MCP_HOSTED=1`, or `--hosted`). Loopback and self-host
 *   deployments need no token at all.
 * - **Minted per session.** One token per client session, minted on demand
 *   (`POST /mcp/token`, or the MCP panel's button). The raw token is returned
 *   exactly once, at mint time; every later view is masked.
 * - **Adoptable.** A deployment may pre-share one token (`adopt`), which is how
 *   a self-host says "this is the token" instead of minting per session. It is
 *   revocable like any other and can be set to never expire.
 * - **Short-lived.** `ttlMs` (default 30 minutes, `PIGMA_MCP_TOKEN_TTL_MS`)
 *   after which the token is refused as expired.
 * - **Revocable.** `DELETE /mcp/token` with the token revokes it immediately;
 *   `revokeAll()` drops every session (used on shutdown).
 * - **Bounded.** `maxSessions` is enforced on mint: expired and revoked records
 *   are dropped first, and if the store is still full the oldest live session is
 *   evicted (its holder simply mints again). The store therefore cannot grow
 *   without limit, even under a stream of live sessions.
 *
 * Runtime-agnostic: uses `globalThis.crypto` and an injectable clock, so the
 * same store serves the Node server and tests.
 */
export interface SessionToken {
  /** The raw capability. Never stored anywhere but this record. */
  token: string;
  sessionId: string;
  label: string | null;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
}

/** Why a token was refused. Distinguishable so the caller can say something useful. */
export type TokenFailure = 'unknown' | 'expired' | 'revoked';

export type TokenVerification = { ok: true; session: SessionToken } | { ok: false; reason: TokenFailure };

/** A token record as shown in the status surface: the raw token is never included. */
export interface SessionSummary {
  sessionId: string;
  label: string | null;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
  expired: boolean;
}

export interface TokenStoreOptions {
  /** Lifetime of a minted token. Default 30 minutes. */
  ttlMs?: number;
  now?: () => number;
  /** Token body generator; defaults to 32 random bytes, hex. */
  random?: () => string;
  /**
   * Cap on stored sessions. Enforced on mint: expired/revoked records go first,
   * then the oldest live session is evicted.
   */
  maxSessions?: number;
}

export const DEFAULT_TOKEN_TTL_MS = 30 * 60 * 1000;

function defaultRandom(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export class TokenStore {
  private readonly records = new Map<string, SessionToken>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly random: () => string;
  private readonly maxSessions: number;
  private counter = 0;

  constructor(options: TokenStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TOKEN_TTL_MS;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? defaultRandom;
    this.maxSessions = options.maxSessions ?? 64;
  }

  get lifetimeMs(): number {
    return this.ttlMs;
  }

  get size(): number {
    return this.records.size;
  }

  /**
   * Mint a token for a new session. The caller must show it to the user now.
   * Enforces `maxSessions`: dead records first, then the oldest live session.
   */
  mint(label: string | null = null): SessionToken {
    this.prune();
    while (this.records.size >= this.maxSessions) {
      // Map iteration is insertion order, so this is the oldest session; it
      // covers both a store full of live sessions and equal timestamps.
      const oldest = this.records.keys().next();
      if (oldest.done) break;
      this.records.delete(oldest.value);
    }
    const at = this.now();
    this.counter += 1;
    const session: SessionToken = {
      token: `pigma_${this.random()}`,
      sessionId: `s${this.counter.toString(36)}${at.toString(36)}`,
      label,
      createdAt: at,
      expiresAt: at + this.ttlMs,
      revokedAt: null,
    };
    this.records.set(session.token, session);
    return session;
  }

  /**
   * Register a pre-shared token (a deployment's own secret). `ttlMs: null` means
   * it never expires; it is still revocable, and `revokeAll` drops it.
   */
  adopt(token: string, options: { label?: string | null; ttlMs?: number | null } = {}): SessionToken {
    const at = this.now();
    const ttl = options.ttlMs === undefined ? null : options.ttlMs;
    this.counter += 1;
    const session: SessionToken = {
      token,
      sessionId: `s${this.counter.toString(36)}${at.toString(36)}`,
      label: options.label ?? 'deployment',
      createdAt: at,
      expiresAt: ttl === null ? Number.POSITIVE_INFINITY : at + ttl,
      revokedAt: null,
    };
    this.records.set(token, session);
    return session;
  }

  verify(token: string | null | undefined): TokenVerification {
    if (!token) return { ok: false, reason: 'unknown' };
    const session = this.records.get(token);
    if (!session) return { ok: false, reason: 'unknown' };
    if (session.revokedAt !== null) return { ok: false, reason: 'revoked' };
    if (this.now() >= session.expiresAt) return { ok: false, reason: 'expired' };
    return { ok: true, session };
  }

  /** Revoke one token. Returns whether it existed. */
  revoke(token: string | null | undefined): boolean {
    if (!token) return false;
    const session = this.records.get(token);
    if (!session) return false;
    session.revokedAt = this.now();
    return true;
  }

  /** Revoke everything (server shutdown). Returns how many were live. */
  revokeAll(): number {
    let count = 0;
    for (const session of this.records.values()) {
      if (session.revokedAt === null) {
        session.revokedAt = this.now();
        count += 1;
      }
    }
    return count;
  }

  /** Masked view for the status surface: no raw token ever leaves this method. */
  sessions(): SessionSummary[] {
    const at = this.now();
    return [...this.records.values()].map((session) => ({
      sessionId: session.sessionId,
      label: session.label,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      revokedAt: session.revokedAt,
      expired: at >= session.expiresAt,
    }));
  }

  /** Drop every expired and revoked record (cheap, and keeps the map bounded). */
  private prune(): void {
    const at = this.now();
    for (const [token, session] of this.records) {
      if (session.revokedAt !== null || at >= session.expiresAt) this.records.delete(token);
    }
  }
}

/** `pigma_` + 64 hex characters. Kept in one place so callers can validate shape. */
export function looksLikeToken(value: string): boolean {
  return /^pigma_[0-9a-f]{64}$/.test(value);
}
