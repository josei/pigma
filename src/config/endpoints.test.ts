import { describe, expect, it, beforeEach } from 'vitest';
import {
  ENDPOINT_OVERRIDE_KEY,
  HOSTED_MCP_ENDPOINT,
  HOSTED_RELAY_URL,
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

describe('hosted endpoint defaults', () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = installStorage();
  });

  it('defaults to the hosted relay and the hosted MCP endpoint', () => {
    expect(HOSTED_RELAY_URL).toBe('wss://getpigma.com/relay');
    // The hosted site serves the editor, Rooms and a fully working MCP endpoint
    // through the relay (docs/ROADMAP.md, 2026-10-03).
    expect(HOSTED_MCP_ENDPOINT).toBe('https://getpigma.com/mcp');
    expect(effectiveRelayUrl()).toBe(HOSTED_RELAY_URL);
    expect(effectiveMcpEndpoint()).toBe(HOSTED_MCP_ENDPOINT);
    expect(effectiveRelayUrl({})).toBe(HOSTED_RELAY_URL);
  });

  it('lets an override win, whatever the deployment', () => {
    expect(effectiveRelayUrl({ relay: 'ws://192.168.1.10:8080/collab?room=x' })).toBe('ws://192.168.1.10:8080/collab?room=x');
    expect(effectiveMcpEndpoint({ mcp: 'http://127.0.0.1:3001/mcp' })).toBe('http://127.0.0.1:3001/mcp');
    // A bad override falls back rather than producing an unusable URL.
    expect(effectiveRelayUrl({ relay: 'not a url' })).toBe(HOSTED_RELAY_URL);
    // An empty override falls back to the hosted endpoint.
    expect(effectiveMcpEndpoint({ mcp: '   ' })).toBe(HOSTED_MCP_ENDPOINT);
  });

  it('normalizes endpoints and detects loopback', () => {
    expect(normalizeEndpoint('  wss://example.com/relay  ', HOSTED_RELAY_URL)).toBe('wss://example.com/relay');
    expect(normalizeEndpoint(undefined, HOSTED_RELAY_URL)).toBe(HOSTED_RELAY_URL);
    expect(isLoopbackEndpoint('http://127.0.0.1:3001/mcp')).toBe(true);
    expect(isLoopbackEndpoint('http://localhost:8080/relay')).toBe(true);
    expect(isLoopbackEndpoint('https://getpigma.com/mcp')).toBe(false);
    expect(isLoopbackEndpoint('nonsense')).toBe(false);
  });

  it('remembers overrides per browser and clears them when emptied', () => {
    expect(readEndpointOverrides()).toEqual({});
    saveEndpointOverrides({ relay: 'ws://lan:8080/collab' });
    expect(readEndpointOverrides()).toEqual({ relay: 'ws://lan:8080/collab' });
    expect(storage.has(ENDPOINT_OVERRIDE_KEY)).toBe(true);

    saveEndpointOverrides({ mcp: 'http://127.0.0.1:3001/mcp' });
    expect(readEndpointOverrides()).toEqual({ relay: 'ws://lan:8080/collab', mcp: 'http://127.0.0.1:3001/mcp' });

    // An empty value clears that override; the default comes back.
    saveEndpointOverrides({ relay: '' });
    expect(readEndpointOverrides()).toEqual({ mcp: 'http://127.0.0.1:3001/mcp' });
    expect(effectiveRelayUrl(readEndpointOverrides())).toBe(HOSTED_RELAY_URL);

    saveEndpointOverrides({ mcp: '' });
    expect(readEndpointOverrides()).toEqual({});
    expect(storage.has(ENDPOINT_OVERRIDE_KEY)).toBe(false);
  });

  it('ignores a corrupt override payload', () => {
    storage.set(ENDPOINT_OVERRIDE_KEY, 'not json');
    expect(readEndpointOverrides()).toEqual({});
    storage.set(ENDPOINT_OVERRIDE_KEY, '{"relay":42,"mcp":""}');
    expect(readEndpointOverrides()).toEqual({});
    expect(effectiveRelayUrl(readEndpointOverrides())).toBe(HOSTED_RELAY_URL);
  });
});
