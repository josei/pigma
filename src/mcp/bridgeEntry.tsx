/**
 * Standalone bridge entry: renders the real editor and connects it to a relay.
 *
 * Served by Vite as `bridge.html`. Query parameters:
 *   ?relay=http://127.0.0.1:3002&token=<token>   connect on load
 *   ?blank=1                                      start from an empty document
 *
 * This is a real running-browser bridge (same `App` and store as the main
 * editor), used by the automated browser + MCP SDK test and by anyone who wants
 * a dedicated bridge window.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../App';
import { useEditor } from '../store/editorStore';
import { createEditorSession } from './bridge';
import { connectBridge, type BridgeStatus } from './browserClient';
import '../styles.css';

const params = new URLSearchParams(window.location.search);
if (params.get('blank') === '1') useEditor.getState().newFile();

const relay = params.get('relay');
const token = params.get('token');

function Banner({ status, detail }: { status: BridgeStatus; detail?: string }) {
  return (
    <div
      data-testid="bridge-banner"
      style={{ position: 'fixed', right: 8, bottom: 8, zIndex: 9999, background: '#111', color: '#eee', padding: '4px 8px', fontSize: 12, borderRadius: 4 }}
    >
      MCP bridge: <span data-testid="bridge-banner-status">{status}</span>
      {detail ? ` (${detail})` : ''}
    </div>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

if (relay && token) {
  const banner = document.createElement('div');
  document.body.append(banner);
  const render = (status: BridgeStatus, detail?: string): void => {
    createRoot(banner).render(<Banner status={status} detail={detail} />);
  };
  render('connecting');
  connectBridge({
    url: relay,
    token,
    name: 'pigma-browser',
    session: createEditorSession(useEditor),
    onStatus: render,
  });
}
