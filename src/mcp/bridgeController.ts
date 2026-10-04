/**
 * App-level owner of the browser bridge connection.
 *
 * The bridge must outlive any single component: if the connection lived inside
 * `BridgePanel`, unmounting the panel (e.g. switching the left rail away from
 * the Tools tab) would silently close it and kill in-flight MCP commands.
 *
 * The controller holds one client for the whole app; the panel only renders
 * state and calls `connect`/`disconnect`. `useSyncExternalStore` keeps the UI in
 * sync without owning the lifetime.
 */
import { useEditor } from '../store/editorStore';
import { createEditorSession } from './bridge';
import { connectBridge, type BridgeClient, type BridgeStatus } from './browserClient';

export interface BridgeControllerState {
  status: BridgeStatus;
  detail?: string;
  url: string;
  token: string;
}

let client: BridgeClient | null = null;
let state: BridgeControllerState = { status: 'disconnected', url: 'http://127.0.0.1:3002', token: '' };
const listeners = new Set<() => void>();

function emit(next: Partial<BridgeControllerState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

export function getBridgeState(): BridgeControllerState {
  return state;
}

export function subscribeBridge(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setBridgeTarget(url: string, token: string): void {
  emit({ url, token });
}

/** Connect the live editor to a relay. Idempotent: replaces any existing client. */
export function connectBridgeSession(name = 'pigma-editor', factory: typeof connectBridge = connectBridge): void {
  client?.close();
  emit({ status: 'connecting', detail: undefined });
  client = factory({
    url: state.url,
    token: state.token,
    name,
    session: createEditorSession(useEditor),
    onStatus: (status, detail) => emit({ status, detail }),
  });
}

export function disconnectBridgeSession(detail?: string): void {
  client?.close();
  client = null;
  emit({ status: 'disconnected', detail });
}

/** Current client, for tests/diagnostics. */
export function bridgeClient(): BridgeClient | null {
  return client;
}
