import { describe, expect, it, vi } from 'vitest';
import { CONFIG_PATH } from '../../server/config';
import {
  MCP_CONFIG_PATH,
  offersMcp,
  readAdvertisedMcp,
  readDesktopInfo,
  resolveMcpAvailability,
  toAdvertisement,
} from './mcpAvailability';

const loopback = {
  endpoint: 'http://127.0.0.1:3001/mcp',
  mode: 'loopback' as const,
  tokenRequired: false,
  bridgeBase: null,
};
const server = {
  endpoint: 'https://studio.example.test/mcp',
  mode: 'server' as const,
  tokenRequired: true,
  bridgeBase: 'https://studio.example.test',
};

describe('MCP availability', () => {
  it('falls back to the hosted endpoint, which needs a session token', () => {
    const availability = resolveMcpAvailability({ desktop: null, advertised: null });
    expect(availability).toEqual({
      kind: 'hosted',
      endpoint: 'https://getpigma.com/mcp',
      token: null,
      tokenRequired: true,
    });
    // Every state offers a connection; they differ in endpoint and token only.
    expect(offersMcp(availability)).toBe(true);
  });

  it('is the desktop state for the shell or a bundled loopback server', () => {
    expect(resolveMcpAvailability({ desktop: loopback, advertised: null })).toEqual({
      kind: 'desktop',
      endpoint: loopback.endpoint,
      token: null,
      tokenRequired: false,
    });
    // What a *server* advertises is a self-host, even on this machine: only the
    // shell's own report is the desktop state.
    expect(resolveMcpAvailability({ desktop: null, advertised: loopback })).toMatchObject({
      kind: 'self-hosted',
      endpoint: loopback.endpoint,
    });
  });

  it('is self-hosted for a server, with the token it was given', () => {
    expect(resolveMcpAvailability({ desktop: null, advertised: server })).toEqual({
      kind: 'self-hosted',
      endpoint: server.endpoint,
      token: null,
      tokenRequired: true,
    });
    // A loopback token comes from the shell (never from the advertisement).
    expect(
      resolveMcpAvailability({ desktop: loopback, advertised: null, desktopToken: 'pigma_secret' }),
    ).toMatchObject({ kind: 'desktop', token: 'pigma_secret' });
  });

  it('treats only a typed endpoint as an override', () => {
    // The hosted default is the hosted state, not an override.
    expect(resolveMcpAvailability({ desktop: null, advertised: null, overrides: {} })).toMatchObject({ kind: 'hosted' });
    expect(resolveMcpAvailability({ desktop: null, advertised: null, overrides: { mcp: '   ' } })).toMatchObject({
      kind: 'hosted',
    });
  });

  it('lets the user’s own endpoint win, and calls it self-hosted', () => {
    expect(
      resolveMcpAvailability({
        desktop: loopback,
        advertised: server,
        overrides: { mcp: 'http://192.168.1.10:3001/mcp' },
      }),
    ).toEqual({
      kind: 'self-hosted',
      endpoint: 'http://192.168.1.10:3001/mcp',
      token: null,
      tokenRequired: false,
    });
    // An empty override changes nothing.
    expect(resolveMcpAvailability({ desktop: loopback, advertised: null, overrides: { mcp: '  ' } })).toMatchObject({
      kind: 'desktop',
    });
  });

  it('reads the advertised config shape and ignores a disabled or empty one', () => {
    expect(
      toAdvertisement({
        mode: 'server',
        mcp: { enabled: true, url: server.endpoint, tokenRequired: true },
        bridge: { enabled: true, path: '/bridge' },
      }),
    ).toEqual(server);
    // A deployment that mounts no bridge advertises none, and the panel keeps
    // its own default rather than inventing one.
    expect(
      toAdvertisement({ mode: 'server', mcp: { enabled: true, url: server.endpoint, tokenRequired: true } }),
    ).toMatchObject({ bridgeBase: null });
    // MCP disabled, no URL, or a malformed URL: not an advertisement.
    expect(toAdvertisement({ mode: 'server', mcp: { enabled: false } })).toBeNull();
    expect(toAdvertisement({ mode: 'server', mcp: { enabled: true } })).toBeNull();
    expect(toAdvertisement({ mode: 'server', mcp: { enabled: true, url: 'not a url' } })).toBeNull();
    expect(toAdvertisement(null)).toBeNull();
    expect(toAdvertisement({})).toBeNull();
  });

  it('pins the advertised path to the server’s own constant', () => {
    // The client does not import server code; this is the guard that the mirror
    // stays honest.
    expect(MCP_CONFIG_PATH).toBe(CONFIG_PATH);
  });

  it('treats a missing or failing config endpoint as no advertisement', async () => {
    const notFound = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;
    expect(await readAdvertisedMcp(notFound)).toBeNull();
    const broken = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await readAdvertisedMcp(broken)).toBeNull();
    const ok = (async () =>
      new Response(JSON.stringify({ mode: 'loopback', mcp: { enabled: true, url: loopback.endpoint } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;
    expect(await readAdvertisedMcp(ok)).toEqual({ ...loopback, tokenRequired: false, bridgeBase: null });
  });
});

describe('the desktop shell’s report', () => {
  it('resolves the desktop state from the payload the shell actually serializes', async () => {
    // These are the wire keys of the shell's `DesktopInfo` struct, pinned
    // Rust-side by `desktop_info_serializes_camel_case` (src-tauri/src/main.rs).
    // Reading a field the shell does not send is how the desktop state silently
    // disappears: the panel falls through to hosted with no error.
    const payload = {
      mcpEndpoint: 'http://127.0.0.1:3001/mcp',
      relayUrl: 'wss://getpigma.com/relay',
      localMcpEndpoint: 'http://127.0.0.1:3001/mcp',
      localRelayUrl: 'ws://127.0.0.1:3002/relay',
      mcpTokenRequired: false,
      assetOrigin: null,
    };
    vi.stubGlobal('window', { __TAURI__: { core: { invoke: async () => payload } } });
    try {
      const report = await readDesktopInfo();
      expect(report).toEqual({
        advertisement: {
          endpoint: payload.mcpEndpoint,
          mode: 'loopback',
          tokenRequired: false,
          bridgeBase: null,
        },
        token: null,
      });
      // …and that report is what puts the panel in its desktop state.
      expect(
        resolveMcpAvailability({ desktop: report!.advertisement, advertised: null, desktopToken: report!.token }),
      ).toEqual({ kind: 'desktop', endpoint: payload.mcpEndpoint, token: null, tokenRequired: false });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('honours a shell that reports a token is required', async () => {
    vi.stubGlobal('window', {
      __TAURI__: {
        core: {
          invoke: async () => ({ mcpEndpoint: 'http://127.0.0.1:3001/mcp', mcpTokenRequired: true }),
        },
      },
    });
    try {
      const report = await readDesktopInfo();
      expect(report?.advertisement.tokenRequired).toBe(true);
      expect(resolveMcpAvailability({ desktop: report!.advertisement, advertised: null })).toMatchObject({
        kind: 'desktop',
        tokenRequired: true,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('is no shell at all in a browser, without touching the network', async () => {
    expect(await readDesktopInfo()).toBeNull();
  });
});
