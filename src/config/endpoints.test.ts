import { describe, expect, it, beforeEach } from 'vitest';
import {
  ENDPOINT_OVERRIDE_KEY,
  effectiveMcpEndpoint,
  effectiveRelayUrl,
  isLoopbackEndpoint,
  normalizeEndpoint,
  readEndpointOverrides,
  saveEndpointOverrides,
} from './endpoints';

function installStorage(): Map<string, string> {
  const map = new Map<string, string>();
  const shim = {
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, String(value)),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
  } as unknown as Storage;
  (globalThis as unknown as { localStorage: Storage }).localStorage = shim;
  return map;
}

describe('endpoint defaults', () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = installStorage();
  });

  it('has no built-in relay or MCP endpoint: nothing is reached until a server is named', () => {
    // The static online copy runs no server, so there is nothing to default to.
    expect(effectiveMcpEndpoint()).toBeNull();
    expect(effectiveMcpEndpoint({})).toBeNull();
    expect(effectiveRelayUrl()).toBeNull();
    expect(effectiveRelayUrl({})).toBeNull();
  });

  it('uses the relay this page is served by when there is one', () => {
    expect(effectiveRelayUrl({}, 'wss://self.example/relay')).toBe('wss://self.example/relay');
  });

  it('lets an override win, whatever the page serves', () => {
    expect(effectiveRelayUrl({ relay: 'ws://192.168.1.10:8080/collab?room=x' }, 'wss://self.example/relay')).toBe(
      'ws://192.168.1.10:8080/collab?room=x',
    );
    expect(effectiveMcpEndpoint({ mcp: 'http://127.0.0.1:3001/mcp' })).toBe('http://127.0.0.1:3001/mcp');
    // A bad override falls back rather than producing an unusable URL.
    expect(effectiveRelayUrl({ relay: 'not a url' })).toBeNull();
    expect(effectiveRelayUrl({ relay: 'not a url' }, 'wss://self.example/relay')).toBe('wss://self.example/relay');
    // A blank override is no override.
    expect(effectiveMcpEndpoint({ mcp: '   ' })).toBeNull();
  });

  it('normalizes endpoints and detects loopback', () => {
    expect(normalizeEndpoint('  wss://example.com/relay  ', null)).toBe('wss://example.com/relay');
    expect(normalizeEndpoint(undefined, 'wss://fallback.example/relay')).toBe('wss://fallback.example/relay');
    expect(isLoopbackEndpoint('http://127.0.0.1:3001/mcp')).toBe(true);
    expect(isLoopbackEndpoint('http://localhost:8080/relay')).toBe(true);
    expect(isLoopbackEndpoint('https://example.com/mcp')).toBe(false);
    expect(isLoopbackEndpoint('nonsense')).toBe(false);
  });

  it('remembers overrides per browser and clears them when emptied', () => {
    expect(readEndpointOverrides()).toEqual({});
    saveEndpointOverrides({ relay: 'ws://lan:8080/collab' });
    expect(readEndpointOverrides()).toEqual({ relay: 'ws://lan:8080/collab' });
    expect(storage.has(ENDPOINT_OVERRIDE_KEY)).toBe(true);

    saveEndpointOverrides({ mcp: 'http://127.0.0.1:3001/mcp' });
    expect(readEndpointOverrides()).toEqual({ relay: 'ws://lan:8080/collab', mcp: 'http://127.0.0.1:3001/mcp' });

    // An empty value clears that override; with none left, there is no relay again.
    saveEndpointOverrides({ relay: '' });
    expect(readEndpointOverrides()).toEqual({ mcp: 'http://127.0.0.1:3001/mcp' });
    expect(effectiveRelayUrl(readEndpointOverrides())).toBeNull();

    saveEndpointOverrides({ mcp: '' });
    expect(readEndpointOverrides()).toEqual({});
    expect(storage.has(ENDPOINT_OVERRIDE_KEY)).toBe(false);
  });

  it('ignores a corrupt override payload', () => {
    storage.set(ENDPOINT_OVERRIDE_KEY, 'not json');
    expect(readEndpointOverrides()).toEqual({});
    storage.set(ENDPOINT_OVERRIDE_KEY, '{"relay":42,"mcp":""}');
    expect(readEndpointOverrides()).toEqual({});
    expect(effectiveRelayUrl(readEndpointOverrides())).toBeNull();
  });
});
