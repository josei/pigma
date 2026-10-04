import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bridgeClient,
  connectBridgeSession,
  disconnectBridgeSession,
  getBridgeState,
  setBridgeTarget,
  subscribeBridge,
} from '../../src/mcp/bridgeController';
import type { BridgeClient } from '../../src/mcp/browserClient';

interface FakeHandle {
  closed: boolean;
  client: BridgeClient;
  emit: (status: 'connected' | 'error' | 'disconnected', detail?: string) => void;
}

function fakeFactory(): { factory: typeof import('../../src/mcp/browserClient').connectBridge; handles: FakeHandle[] } {
  const handles: FakeHandle[] = [];
  const factory = ((options: { onStatus?: (status: never, detail?: string) => void }) => {
    const handle: FakeHandle = {
      closed: false,
      emit: (status, detail) => options.onStatus?.(status as never, detail),
      client: {
        close: () => {
          handle.closed = true;
          options.onStatus?.('disconnected' as never);
        },
        status: () => 'connected',
        revision: () => 0,
      },
    };
    handles.push(handle);
    return handle.client;
  }) as unknown as typeof import('../../src/mcp/browserClient').connectBridge;
  return { factory, handles };
}

afterEach(() => {
  disconnectBridgeSession();
});

describe('bridge controller lifetime', () => {
  it('keeps the connection when the panel unmounts (subscriber churn)', () => {
    const { factory, handles } = fakeFactory();
    setBridgeTarget('http://127.0.0.1:3002', 'token');
    connectBridgeSession('test', factory);
    handles[0]?.emit('connected');
    expect(getBridgeState().status).toBe('connected');

    // Simulate the panel mounting and unmounting repeatedly (tab switches).
    for (let i = 0; i < 3; i++) {
      const unsubscribe = subscribeBridge(() => undefined);
      unsubscribe();
    }

    // The connection survived: the panel no longer owns its lifetime.
    expect(bridgeClient()).not.toBeNull();
    expect(handles[0]?.closed).toBe(false);
    expect(getBridgeState().status).toBe('connected');
  });

  it('only closes the client on an explicit disconnect', () => {
    const { factory, handles } = fakeFactory();
    connectBridgeSession('test', factory);
    handles[0]?.emit('connected');

    disconnectBridgeSession();
    expect(handles[0]?.closed).toBe(true);
    expect(bridgeClient()).toBeNull();
    expect(getBridgeState().status).toBe('disconnected');
  });

  it('surfaces a connection error in state', () => {
    const { factory, handles } = fakeFactory();
    connectBridgeSession('test', factory);
    handles[0]?.emit('error', 'relay connection lost');
    expect(getBridgeState()).toMatchObject({ status: 'error', detail: 'relay connection lost' });
  });

  it('notifies subscribers on state changes', () => {
    const { factory, handles } = fakeFactory();
    const listener = vi.fn();
    subscribeBridge(listener);
    connectBridgeSession('test', factory);
    handles[0]?.emit('connected');
    expect(listener).toHaveBeenCalled();
    expect(getBridgeState().status).toBe('connected');
  });
});
