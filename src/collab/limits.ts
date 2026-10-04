/**
 * Abuse bounds for the relay: a sliding-window rate limiter and the limit
 * defaults every deployment starts from.
 *
 * These exist to keep a public relay usable, not to meter anyone: they are
 * deliberately generous (a cursor drag is tens of messages per second), and
 * every one of them is overridable per deployment. Nothing here identifies a
 * person — keys are IP addresses, used only to bound resource use.
 */

export interface RateLimiterOptions {
  /** Units allowed per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  now?: () => number;
}

/**
 * Fixed-window counter per key. Fixed windows are deliberate: one counter per
 * key, no timers, no unbounded history, and the worst case (a burst spanning a
 * window boundary) is at most 2× the limit, which is fine for an abuse bound.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, { windowStart: number; count: number }>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(options: RateLimiterOptions) {
    this.limit = options.limit;
    this.windowMs = options.windowMs;
    this.now = options.now ?? Date.now;
  }

  get capacity(): number {
    return this.limit;
  }

  get window(): number {
    return this.windowMs;
  }

  /** Tracked keys; bounded by the caller pruning, see `prune`. */
  get size(): number {
    return this.buckets.size;
  }

  /** Consume one unit. Returns false when the key has exhausted its window. */
  tryConsume(key: string): boolean {
    const at = this.now();
    const bucket = this.buckets.get(key);
    if (!bucket || at - bucket.windowStart >= this.windowMs) {
      this.buckets.set(key, { windowStart: at, count: 1 });
      return true;
    }
    if (bucket.count >= this.limit) return false;
    bucket.count += 1;
    return true;
  }

  /** Units left in the current window (the full limit when the key is unseen). */
  remaining(key: string): number {
    const bucket = this.buckets.get(key);
    if (!bucket || this.now() - bucket.windowStart >= this.windowMs) return this.limit;
    return Math.max(0, this.limit - bucket.count);
  }

  /** Drop windows that have fully expired, so the map cannot grow forever. */
  prune(): number {
    const at = this.now();
    let removed = 0;
    for (const [key, bucket] of this.buckets) {
      if (at - bucket.windowStart >= this.windowMs) {
        this.buckets.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  reset(key?: string): void {
    if (key === undefined) this.buckets.clear();
    else this.buckets.delete(key);
  }
}

/** Every bound the relay applies, with its default. */
export interface RelayLimits {
  /** Participants allowed in one room. */
  maxRoomPeers: number;
  /** Concurrent sockets from one IP address. */
  maxConnectionsPerIp: number;
  /** Upgrade attempts per IP per minute. */
  connectionAttemptsPerMinute: number;
  /** Relay messages per IP per window (cursors, selections, ops, snapshots). */
  messagesPerWindow: number;
  /** Message window length. */
  messageWindowMs: number;
  /** Idle empty rooms are dropped after this. */
  roomTtlMs: number;
  /** Snapshots are a cache, never storage: dropped after this. */
  snapshotTtlMs: number;
  /** How often the sweep runs. */
  gcIntervalMs: number;
}

export const DEFAULT_LIMITS: RelayLimits = {
  maxRoomPeers: 32,
  maxConnectionsPerIp: 16,
  connectionAttemptsPerMinute: 30,
  // Generous: a drag emits a cursor per frame (~60/s) plus selections and ops.
  messagesPerWindow: 1800,
  messageWindowMs: 10_000,
  roomTtlMs: 10 * 60_000,
  snapshotTtlMs: 24 * 60 * 60_000,
  gcIntervalMs: 60_000,
};

export function resolveLimits(overrides: Partial<RelayLimits> = {}): RelayLimits {
  return { ...DEFAULT_LIMITS, ...overrides };
}
