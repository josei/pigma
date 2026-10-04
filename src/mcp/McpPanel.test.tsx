import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { McpPanel, endpointFor, maskToken } from './McpPanel';
import { harnessConfigs } from './harnessConfig';
import type { McpEnvironment } from '../config/mcpAvailability';

describe('MCP panel helpers', () => {
  it('masks a token while keeping its shape recognisable', () => {
    const token = `pigma_${'a'.repeat(64)}`;
    const masked = maskToken(token);
    expect(masked.startsWith('pigm')).toBe(true);
    expect(masked.endsWith('aaaa')).toBe(true);
    expect(masked).not.toBe(token);
    expect(masked).not.toContain('a'.repeat(20));
    // Short and empty tokens never leak.
    expect(maskToken('short')).toBe('•••••');
    expect(maskToken('')).toBe('');
  });

  it('derives the endpoint from the relay the editor talks to', () => {
    expect(endpointFor('http://127.0.0.1:3002')).toBe('http://127.0.0.1:3002/mcp');
    expect(endpointFor('https://example.test')).toBe('https://example.test/mcp');
    // There is no hosted MCP endpoint to fall back to: a malformed relay URL
    // yields none, and the panel stays in its hosted state.
    expect(endpointFor('not a url')).toBeNull();
  });

  it('feeds the harness snippets the same endpoint the panel shows', () => {
    const endpoint = endpointFor('http://127.0.0.1:3002')!;
    const token = `pigma_${'b'.repeat(64)}`;
    const configs = harnessConfigs({ endpoint, token });
    expect(configs.map((entry) => entry.id)).toEqual(['claude', 'cursor', 'codex']);
    for (const entry of configs) {
      expect(entry.content).toContain(endpoint);
      expect(entry.content).toContain(token);
    }
    // Without a token the snippets do not invent one.
    expect(harnessConfigs({ endpoint, token: null }).every((entry) => !entry.content.includes('Authorization'))).toBe(true);
  });
});

describe('MCP panel states', () => {
  /** Render the panel with a given environment, as the three states see it. */
  const render = (environment: Partial<McpEnvironment>) =>
    renderToStaticMarkup(
      <McpPanel environment={{ desktop: null, advertised: null, desktopToken: null, ...environment }} />,
    );

  it('offers the hosted endpoint with a session token, not a dead end', () => {
    const html = render({});
    expect(html).toContain('data-mcp-state="hosted"');
    expect(html).toContain('data-mcp-endpoint="https://getpigma.com/mcp"');
    // The same connection surface as the other states.
    expect(html).toContain('aria-label="MCP endpoint"');
    expect(html).toContain('aria-label="MCP token"');
    expect(html).toContain('aria-label="Harness"');
    expect(html).toContain('mcp-bridge-panel');
    expect(html).toContain('aria-label="Get a session token"');
    // ...and none of the old "download the app" dead end.
    expect(html).not.toContain('mcp-desktop-link');
    expect(html).not.toContain('mcp-hosted-note');
    expect(html).not.toContain('not offered');
    expect(html).toContain('served by the relay');
  });

  it('shows the loopback endpoint with no token in the desktop state', () => {
    const html = render({
      desktop: { endpoint: 'http://127.0.0.1:3001/mcp', mode: 'loopback', tokenRequired: false, bridgeBase: null },
    });
    expect(html).toContain('data-mcp-state="desktop"');
    expect(html).toContain('data-mcp-endpoint="http://127.0.0.1:3001/mcp"');
    expect(html).toContain('aria-label="MCP endpoint"');
    expect(html).toContain('none required');
    expect(html).toContain('no token needed');
    expect(html).toContain('mcp-bridge-panel');
    // No token to mint: the loopback endpoint needs none.
    expect(html).not.toContain('aria-label="Get a session token"');
  });

  it('shows the server URL and its token in the self-hosted state', () => {
    const html = render({
      advertised: {
        endpoint: 'https://studio.example.test/mcp',
        mode: 'server',
        tokenRequired: true,
        bridgeBase: 'https://studio.example.test',
      },
      desktopToken: 'pigma_secret_token',
    });
    expect(html).toContain('data-mcp-state="self-hosted"');
    expect(html).toContain('data-mcp-endpoint="https://studio.example.test/mcp"');
    // The token is shown masked, never raw.
    expect(html).not.toContain('pigma_secret_token');
    expect(html).toContain(maskToken('pigma_secret_token'));
    expect(html).toContain('aria-label="Harness"');
    expect(html).toContain('mcp-bridge-panel');
  });
});
