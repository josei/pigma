/**
 * Connect UX for the external-client ↔ browser bridge.
 *
 * The connection is owned by `bridgeController` (app-level), so unmounting this
 * panel — e.g. switching the left rail away from the Tools tab — never drops the
 * bridge or kills an in-flight MCP command. The panel only renders state and
 * calls connect/disconnect.
 *
 * Layout is class-driven (`.bridge`, `.bridge__row`, …); no inline styles.
 */
import { useSyncExternalStore } from 'react';
import {
  connectBridgeSession,
  disconnectBridgeSession,
  getBridgeState,
  setBridgeTarget,
  subscribeBridge,
} from './bridgeController';

export interface BridgePanelProps {
  /** Relay base URL. Matches `bin.ts --bridge`'s `--relay-port`. */
  defaultUrl?: string;
}

export function BridgePanel({ defaultUrl }: BridgePanelProps) {
  const state = useSyncExternalStore(subscribeBridge, getBridgeState, getBridgeState);
  const url = state.url || defaultUrl || 'http://127.0.0.1:3002';
  const connected = state.status === 'connected';
  const connecting = state.status === 'connecting';

  return (
    <div className="bridge" data-testid="mcp-bridge-panel">
      <p className="bridge__row">
        <label className="bridge__label" htmlFor="bridge-url">
          Relay URL
        </label>
        <input
          id="bridge-url"
          className="input"
          aria-label="Relay URL"
          value={url}
          onChange={(event) => setBridgeTarget(event.target.value, state.token)}
          disabled={connected || connecting}
          placeholder="http://127.0.0.1:3002"
        />
      </p>
      <p className="bridge__row">
        <label className="bridge__label" htmlFor="bridge-token">
          Relay token
        </label>
        <input
          id="bridge-token"
          className="input"
          type="password"
          aria-label="Relay token"
          value={state.token}
          onChange={(event) => setBridgeTarget(url, event.target.value)}
          disabled={connected || connecting}
          placeholder="token"
        />
      </p>
      <div className="bridge__actions">
        <span className="bridge__status" data-testid="mcp-bridge-status">
          MCP: {state.status}
        </span>
        {connected || connecting ? (
          <button className="button" type="button" onClick={() => disconnectBridgeSession()}>
            Disconnect
          </button>
        ) : (
          <button
            className="button button--primary"
            type="button"
            onClick={() => connectBridgeSession()}
            disabled={state.token.length === 0}
          >
            Connect MCP
          </button>
        )}
      </div>
      {state.detail ? <p className="bridge__detail">{state.detail}</p> : null}
    </div>
  );
}
