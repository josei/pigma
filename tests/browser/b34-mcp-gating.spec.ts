import { test, expect, type Page } from '@playwright/test';

/**
 * MCP panel states (product decision recorded in docs/ROADMAP.md).
 *
 * There is no built-in MCP endpoint: an agent needs a Pigma server, which the
 * desktop app or a self-hosted server provides. With nothing advertised the panel
 * says so and offers no connection (the static online copy is this state). The
 * panel renders a stable state hook,
 * `[data-testid="mcp-panel"][data-mcp-state="unavailable|desktop|self-hosted"]`.
 *
 * State is driven by the server advertisement at `/config.json`
 * (src/config/mcpAvailability.ts, MCP_CONFIG_PATH), whose payload is
 * `{ mode: 'loopback' | 'server', mcp: { enabled, url, tokenRequired } }`.
 * The dev server advertises a loopback endpoint on purpose - that is what keeps
 * the bridge specs (b16/b17/b18/b26) green - so these specs control the
 * advertisement explicitly rather than relying on the ambient one.
 */

const CONFIG = '**/config.json';
const panel = (page: Page) => page.locator('[data-testid="mcp-panel"]');

async function openTools(page: Page) {
  await page.goto('/app/?blank=1');
  await page.waitForSelector('.app');
  await page.locator('.rail__button[aria-label="AI agent"]').click();
  // The panel's own state attribute is what the tests read next: wait for the panel to exist.
  await expect(page.locator('[data-testid="mcp-panel"], [data-mcp-state]').first()).toBeVisible();
}

/** Pretend nothing advertises MCP: the static online copy, which has no server. */
async function asUnavailable(page: Page) {
  await page.route(CONFIG, (route) => route.fulfill({ status: 404, body: '' }));
}

/** Advertise a self-hosted server that requires a token. */
async function asSelfHosted(page: Page, url: string) {
  await page.route(CONFIG, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ mode: 'server', mcp: { enabled: true, url, tokenRequired: true } }),
    }),
  );
}

test('B34a with no server the panel says so, and offers no connection', async ({ page }) => {
  await asUnavailable(page);
  await openTools(page);

  await expect(panel(page)).toHaveAttribute('data-mcp-state', 'unavailable');
  await expect(panel(page)).toContainText('needs a Pigma server');
  // No endpoint to connect to, so no endpoint field, no bridge and no token request.
  await expect(page.locator('input[aria-label="MCP endpoint"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="mcp-bridge-panel"]')).toHaveCount(0);
  await expect(page.locator('button[aria-label="Get a session token"]')).toHaveCount(0);
});

test('B34b an advertised self-hosted endpoint surfaces the endpoint and a token', async ({
  page,
}) => {
  const url = 'https://mcp.example.test/mcp';
  await asSelfHosted(page, url);
  await openTools(page);

  await expect(panel(page)).toHaveAttribute('data-mcp-state', 'self-hosted');
  await expect(panel(page)).toContainText(url);

  // A token-requiring deployment must offer a token field...
  await expect(page.locator('input[aria-label="Relay token"]')).toHaveCount(1);
  // ...and the connect affordance.
  await expect(page.locator('button', { hasText: /connect mcp/i })).toHaveCount(1);
});

/**
 * An ADVERTISED loopback endpoint is still `self-hosted`: `desktop` is reserved
 * for the Tauri shell reporting `desktop_info` (resolveMcpAvailability: the
 * `desktop` branch comes from environment.desktop, the advertised branch always
 * yields self-hosted). B34d below reaches the desktop state by supplying the
 * shell's own report the way the shell does - `window.__TAURI__.core.invoke` -
 * so the state IS reachable from a browser spec; only the real IPC hop needs
 * the shell.
 */
test('B34c an advertised loopback endpoint is self-hosted and labelled as this machine', async ({
  page,
}) => {
  await page.route(CONFIG, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ mode: 'loopback', mcp: { enabled: true, url: 'http://127.0.0.1:3111/mcp', tokenRequired: false } }),
    }),
  );
  await openTools(page);

  await expect(panel(page)).toHaveAttribute('data-mcp-state', 'self-hosted');
  await expect(panel(page)).toContainText('127.0.0.1');
  await expect(panel(page)).toContainText(/this machine/i);
});

/**
 * The desktop state, from the shell's own report.
 *
 * `desktop_info` is a Tauri command: the panel reaches it through
 * `window.__TAURI__.core.invoke` (src/config/mcpAvailability.ts,
 * `readDesktopInfo`). A browser has no shell, but a spec can supply the report
 * the shell would return, and then the state resolves exactly as it does in the
 * desktop build. The payload below is the shell's wire shape - camelCase, from
 * `#[serde(rename_all = "camelCase")]` on `DesktopInfo` in
 * src-tauri/src/main.rs, pinned there by `desktop_info_serializes_camel_case`
 * and in src/config/mcpAvailability.test.ts.
 */
test('B34d the desktop state is reached from the shell’s desktop_info report', async ({ page }) => {
  const info = {
    mcpEndpoint: 'http://127.0.0.1:3001/mcp',
    relayUrl: 'ws://127.0.0.1:3002/relay',
    localMcpEndpoint: 'http://127.0.0.1:3001/mcp',
    localRelayUrl: 'ws://127.0.0.1:3002/relay',
    mcpTokenRequired: false,
    assetOrigin: null,
  };
  // Before the app boots: `readEnvironment` reads the report once, on mount.
  await page.addInitScript((report) => {
    (window as unknown as { __TAURI__: unknown }).__TAURI__ = {
      core: { invoke: async (command: string) => (command === 'desktop_info' ? report : null) },
    };
  }, info);
  await openTools(page);

  await expect(panel(page)).toHaveAttribute('data-mcp-state', 'desktop');
  await expect(panel(page)).toHaveAttribute('data-mcp-endpoint', info.mcpEndpoint);
  // The desktop state is the loopback endpoint and needs no token.
  await expect(panel(page)).toContainText('No token needed on the desktop app');
  await expect(page.locator('input[aria-label="MCP token"]')).toHaveValue('none required');
  // A token is never offered for a state that needs none.
  await expect(page.locator('button[aria-label="Get a session token"]')).toHaveCount(0);
});
