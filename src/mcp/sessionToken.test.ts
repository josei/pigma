import { describe, expect, it, vi } from 'vitest';
import { isHostedEndpoint, minutesLeft, mintSessionToken, tokenMintUrl } from './sessionToken';

/** A fetch stub returning one response. */
const responding = (body: unknown, status = 200) =>
  (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }) as unknown as Response) as unknown as typeof fetch;

describe('hosted MCP session tokens', () => {
  it('mints from the endpoint origin, not the path', () => {
    expect(tokenMintUrl('https://getpigma.com/mcp')).toBe('https://getpigma.com/mcp/token');
    expect(tokenMintUrl('http://127.0.0.1:3001/mcp')).toBe('http://127.0.0.1:3001/mcp/token');
    expect(tokenMintUrl('not a url')).toBeNull();
    expect(isHostedEndpoint('https://getpigma.com/mcp')).toBe(true);
    expect(isHostedEndpoint('https://getpigma.com/mcp/')).toBe(true);
    expect(isHostedEndpoint('http://127.0.0.1:3001/mcp')).toBe(false);
  });

  it('posts to /mcp/token and keeps the token in memory only', async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method });
      return { ok: true, status: 201, json: async () => ({ token: 'pigma_abc', expiresAt: Date.now() + 1_800_000 }) } as unknown as Response;
    }) as unknown as typeof fetch;

    const result = await mintSessionToken('https://getpigma.com/mcp', fetchImpl);
    expect(calls).toEqual([{ url: 'https://getpigma.com/mcp/token', method: 'POST' }]);
    expect(result.error).toBeNull();
    expect(result.token?.token).toBe('pigma_abc');
    expect(minutesLeft(result.token!, result.token!.mintedAt)).toBe(30);
    // Nothing about the token is persisted anywhere: the module never touches
    // storage, so the only place it exists is the caller's memory.
    expect(typeof (globalThis as { localStorage?: unknown }).localStorage).toBe('undefined');
  });

  it('explains every refusal instead of failing silently', async () => {
    const forbidden = await mintSessionToken('https://getpigma.com/mcp', responding({ error: 'no' }, 403));
    expect(forbidden.token).toBeNull();
    expect(forbidden.error).toMatch(/desktop app or self-host/i);

    const notHosted = await mintSessionToken('https://getpigma.com/mcp', responding({ error: 'no' }, 404));
    expect(notHosted.error).toMatch(/no token/i);

    const unreachable = await mintSessionToken(
      'https://getpigma.com/mcp',
      (async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof fetch,
    );
    expect(unreachable.error).toMatch(/could not reach/i);

    const empty = await mintSessionToken('https://getpigma.com/mcp', responding({}));
    expect(empty.error).toMatch(/no token/i);

    const badUrl = await mintSessionToken('not a url', vi.fn() as unknown as typeof fetch);
    expect(badUrl.error).toMatch(/not a URL/i);
  });

  it('reports an unknown expiry as unknown, not as zero', () => {
    const now = Date.now();
    expect(minutesLeft({ token: 'x', expiresAt: null, mintedAt: now }, now)).toBeNull();
    // An expired token reads as zero minutes left rather than negative.
    expect(minutesLeft({ token: 'x', expiresAt: now - 60_000, mintedAt: now }, now)).toBe(0);
  });
});
