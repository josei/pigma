/**
 * The bridge answers for ITS OWN PREFIX, and nothing else.
 *
 * The host/origin check used to run BEFORE any path test, so it claimed EVERY
 * request: a public deployment's app root got the bridge's 403 instead of the app
 * (found over a real tunnel). The check must still refuse a public Host on the
 * bridge's OWN paths — it is the editor's private channel and its token is a
 * deployment secret — so the fix is ORDER AND SCOPE, not a looser check.
 */
import { describe, expect, it } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { startRelayServer } from '../../src/mcp/relay';

interface Fake {
  status: number | null;
  body: string;
}

/** Drive the relay's request handler with a bare request object. */
function probe(handle: (req: IncomingMessage, res: ServerResponse) => boolean, url: string, host: string): Fake & { claimed: boolean } {
  const result: Fake = { status: null, body: '' };
  // The SSE route registers a close listener; a bare object needs the stub.
  const request = { url, method: 'GET', headers: { host }, on: () => request } as unknown as IncomingMessage;
  const response = {
    writeHead(status: number) {
      result.status = status;
      return this;
    },
    end(chunk?: string) {
      result.body = chunk ?? '';
      return this;
    },
    // The SSE route writes with `write`, not `end`.
    write(chunk?: string) {
      result.body += chunk ?? '';
      return true;
    },
    on: () => response,
  };
  const claimed = handle(request, response as unknown as ServerResponse);
  return { ...result, claimed };
}

describe('the bridge scopes its host/origin check to /bridge', () => {
  it('falls through for the app root on a public Host, and still refuses its own path', async () => {
    const relay = await startRelayServer({ token: 'scope-token' });
    try {
      // A public Host on a NON-bridge path: NOT claimed, so the deployment's other
      // handlers get the request.
      const root = probe(relay.handle, '/', 'knives.trycloudflare.com');
      expect(root.claimed, 'the bridge claimed the app root').toBe(false);
      expect(root.status).toBeNull();

      // The SAME public Host on the bridge's own path: refused, unchanged.
      const bridge = probe(relay.handle, '/bridge/events?token=x', 'knives.trycloudflare.com');
      expect(bridge.claimed).toBe(true);
      expect(bridge.status).toBe(403);
      expect(bridge.body).toContain('host/origin not allowed');

      // Loopback on the bridge's own path: accepted, so the editor is unaffected.
      const loopback = probe(relay.handle, '/bridge/events?token=scope-token&client=p&cid=p1', '127.0.0.1:8788');
      expect(loopback.claimed).toBe(true);
      expect(loopback.status).toBe(200);
    } finally {
      await relay.close();
    }
  });
});
