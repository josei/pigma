import { useEffect, useState, useSyncExternalStore } from 'react';
import { BridgeFields, BridgePanel } from './BridgePanel';
import { getBridgeState, setBridgeTarget, subscribeBridge } from './bridgeController';
import { harnessConfigs, type HarnessId } from './harnessConfig';
import { isLoopbackEndpoint, readEndpointOverrides, saveEndpointOverrides } from '../config/endpoints';
import { resolveMcpAvailability, type McpEnvironment } from '../config/mcpAvailability';
import { minutesLeft, mintSessionToken, type SessionToken } from './sessionToken';
import { useEditor } from '../store/editorStore';

/**
 * The one MCP panel, in three states .
 *
 * The panel asks what this environment offers (src/config/mcpAvailability.ts)
 * and shows the same connection surface in every case — status, endpoint, masked
 * token, ready-to-paste harness config, bridge controls:
 *
 *   hosted      a remote endpoint, with a per-session token minted by
 *               `POST /mcp/token` — no download needed
 *   desktop     the shell's loopback endpoint, no token needed
 *   self-hosted the server's advertised endpoint (or the user's own), plus its
 *               token when it asks for one
 *
 * The states differ in the endpoint and whether a token is required — never in
 * what the panel offers.
 */

/** Show a token without exposing it, while still allowing a full copy. */
export function maskToken(token: string): string {
  if (token === '') return '';
  if (token.length <= 8) return '•'.repeat(token.length);
  return `${token.slice(0, 4)}${'•'.repeat(Math.min(16, token.length - 8))}${token.slice(-4)}`;
}

/**
 * Endpoint for a relay URL: the same host, `/mcp`. Used when a build derives its
 * MCP endpoint from the relay it talks to; the panel itself shows the effective
 * endpoint (none by default; the user may type one).
 */
export function endpointFor(relayUrl: string): string | null {
  try {
    const url = new URL(relayUrl);
    return `${url.protocol}//${url.host}/mcp`;
  } catch {
    // No hosted MCP endpoint to fall back to: an unusable relay URL yields none.
    return null;
  }
}

const HARNESSES: Array<{ id: HarnessId; label: string }> = [
  { id: 'claude', label: 'Claude Code' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'codex', label: 'Codex' },
];

export interface McpPanelProps {
  /**
   * The environment to render for. Omitted in the app, which reads the store;
   * a test injects one because the three states are otherwise unreachable
   * without a browser (server-rendering sees only the initial store state).
   */
  environment?: McpEnvironment;
}

export function McpPanel({ environment }: McpPanelProps = {}) {
  const state = useSyncExternalStore(subscribeBridge, getBridgeState, getBridgeState);
  const storedEnvironment = useEditor((editor) => editor.mcpEnvironment);
  const mcpEnvironment = environment ?? storedEnvironment;
  const [harness, setHarness] = useState<HarnessId>('claude');
  const [copied, setCopied] = useState<'token' | 'config' | null>(null);
  // Two separate things: what the field shows (pre-filled from the environment,
  // then the user's own text) and whether the user actually overrode it. A
  // pre-filled value must not turn a desktop build into a self-host.
  const [userOverride, setUserOverride] = useState(() => readEndpointOverrides().mcp ?? '');
  const [endpointDraft, setEndpointDraft] = useState(() => readEndpointOverrides().mcp ?? '');
  const [seeded, setSeeded] = useState(false);
  // The hosted endpoint's token lives in this tab's memory only.
  const [session, setSession] = useState<SessionToken | null>(null);
  const [minting, setMinting] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);


  const availability = resolveMcpAvailability({ ...mcpEnvironment, overrides: { mcp: userOverride } });
  // The three states differ in the endpoint and whether a token is required —
  // never in what the panel offers.
  const endpoint = availability.endpoint;
  const tokenRequired = availability.tokenRequired;
  // A token from the environment (desktop) or the bridge wins; otherwise the
  // session token this tab minted for the hosted endpoint.
  const token = availability.token || session?.token || state.token || '';
  const config = harnessConfigs({ endpoint, token: token === '' ? null : token }).find((entry) => entry.id === harness);

  useEffect(() => {
    // Show the environment's endpoint in the field once, so it can be copied or
    // edited; the user's own value (or clearing it) is never overwritten.
    if (seeded) return;
    setEndpointDraft(availability.endpoint);
    setSeeded(true);
  }, [availability, seeded]);

  // A deployment that mounts the editor bridge says so in its advertisement:
  // point the bridge controls at it, so a hosted deployment works without the
  // user typing a URL. The operator's bridge token is never advertised — the
  // bridge accepts a session token instead (src/mcp/relay.ts). Guarded on the
  // value, because writing the bridge state re-renders this panel.
  const advertisedBridge = mcpEnvironment.advertised?.bridgeBase ?? mcpEnvironment.desktop?.bridgeBase ?? null;
  useEffect(() => {
    if (!advertisedBridge) return;
    const current = getBridgeState();
    if (current.url === advertisedBridge) return;
    setBridgeTarget(advertisedBridge, current.token);
  }, [advertisedBridge]);

  /** Mint a session token for the hosted endpoint; resolves to it, or null (the error is shown). */
  const requestToken = async (): Promise<string | null> => {
    setMinting(true);
    const result = await mintSessionToken(endpoint);
    setMinting(false);
    if (!result.token) {
      setTokenError(result.error ?? 'Could not mint a session token.');
      return null;
    }
    setTokenError(null);
    setSession(result.token);
    // The bridge needs the same token to reach the MCP relay: pre-fill it.
    setBridgeTarget(getBridgeState().url, result.token.token);
    const left = minutesLeft(result.token);
    useEditor.getState().pushToast(
      left === null ? 'Token ready — it works until you revoke it' : `Token ready — valid for about ${left} minute${left === 1 ? '' : 's'}`,
      'success',
    );
    return result.token.token;
  };

  /** A harness config needs the token, so fetch one first when this deployment wants it. */
  const ensureToken = async (): Promise<string> => {
    if (token !== '' || !tokenRequired) return token;
    return (await requestToken()) ?? '';
  };

  const copy = async (text: string, what: 'token' | 'config') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied(null);
    }
  };

  const copyConfig = async () => {
    const minted = await ensureToken();
    if (tokenRequired && minted === '') return;
    const ready = harnessConfigs({ endpoint, token: minted === '' ? null : minted }).find((entry) => entry.id === harness);
    await copy(ready?.content ?? '', 'config');
  };

  // No server here (the static online copy): say so, and offer no connection.
  if (availability.kind === 'unavailable') {
    return (
      <div className="section" data-testid="mcp-panel" data-mcp-state="unavailable">
        <div className="section__header">
          <span>AI agent (MCP)</span>
        </div>
        <div className="section__body">
          <p style={{ margin: 0, color: 'var(--figma-text-secondary)' }} data-testid="mcp-state-note">
            The AI agent needs a Pigma server to talk to: the desktop app, or a server you run yourself. This online copy
            runs only in your browser, so there is nothing to connect to here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="section"
      data-testid="mcp-panel"
      data-mcp-state={availability.kind}
      data-mcp-endpoint={endpoint ?? undefined}
    >
      <div className="section__header">
        <span>AI agent (MCP)</span>
        <span style={{ color: 'var(--figma-text-tertiary)' }} data-testid="mcp-status">
          {state.status}
        </span>
      </div>
      <div className="section__body">
        <p style={{ margin: 0, color: 'var(--figma-text-secondary)' }} data-testid="mcp-state-note">
          Let an agent read and edit this file. Pick your tool, copy its setup, then connect.
          {availability.kind === 'desktop' ? ' No token needed on the desktop app.' : ''}
        </p>
        <div className="mcp-setup">
          <select
            className="input"
            aria-label="Harness"
            value={harness}
            onChange={(event) => setHarness(event.target.value as HarnessId)}
          >
            {HARNESSES.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="button"
            aria-label="Copy harness config"
            disabled={minting}
            onClick={() => void copyConfig()}
          >
            {copied === 'config' ? 'Copied' : 'Copy setup'}
          </button>
        </div>
        {config ? (
          <p style={{ margin: 0, color: 'var(--figma-text-secondary)' }}>
            Paste it into <code>{config.path}</code>
          </p>
        ) : null}
        {tokenError ? (
          <p role="alert" style={{ margin: 0, color: 'var(--figma-danger)' }} data-testid="mcp-token-error">
            {tokenError}
          </p>
        ) : null}
        <BridgePanel
          canPrepare={tokenRequired && token === ''}
          prepare={async () => (token !== '' || !tokenRequired ? true : (await requestToken()) !== null)}
        />
        <details className="advanced" data-testid="mcp-advanced">
          <summary>Advanced</summary>
          <div className="prop-row">
            <span className="prop-row__label">Endpoint</span>
            <input
              className="input"
              aria-label="MCP endpoint"
              placeholder={availability.endpoint}
              value={endpointDraft}
              onChange={(event) => {
                setEndpointDraft(event.target.value);
                setUserOverride(event.target.value);
                saveEndpointOverrides({ mcp: event.target.value });
              }}
            />
            <button
              type="button"
              className="icon-button"
              aria-label="Copy MCP endpoint"
              data-tooltip="Copy the endpoint"
              onClick={() => void copy(endpoint ?? '', 'config')}
            >
              {copied === 'config' ? '✓' : '⧉'}
            </button>
          </div>
          <p style={{ margin: 0, color: 'var(--figma-text-secondary)' }}>
            Effective: <code aria-label="Effective MCP endpoint">{endpoint}</code>
            {isLoopbackEndpoint(endpoint ?? '') ? ' (this machine)' : ''}

          </p>
          <div className="prop-row">
            <span className="prop-row__label">Token</span>
            <input
              className="input"
              aria-label="MCP token"
              readOnly
              value={token === '' ? (tokenRequired ? 'required by this deployment' : 'none required') : maskToken(token)}
            />
            {tokenRequired && token === '' ? (
              <button
                type="button"
                className="button"
                aria-label="Get a session token"
                data-tooltip="Ask this deployment for a token. It works until it is revoked."
                disabled={minting}
                onClick={() => void requestToken()}
              >
                {minting ? 'Requesting…' : 'Get token'}
              </button>
            ) : null}
            <button
              type="button"
              className="icon-button"
              aria-label="Copy MCP token"
              data-tooltip={
                token === ''
                  ? tokenRequired
                    ? 'This deployment requires a token: use Get token'
                    : 'No token: the desktop app and loopback need none'
                  : 'Copy the token'
              }
              disabled={token === ''}
              onClick={() => void copy(token, 'token')}
            >
              {copied === 'token' ? '✓' : '⧉'}
            </button>
          </div>
          <BridgeFields />
        </details>
      </div>
    </div>
  );
}
