import { test, expect, type Page } from '@playwright/test';

/**
 * MCP panel states (product decision recorded in docs/ROADMAP.md).
 *
 * getpigma.com offers a fully working MCP endpoint through the relay (decision
 * 2026-10-03, reversing the earlier one), so MCP needs no download. The panel
 * renders a stable state hook,
 * `[data-testid="mcp-panel"][data-mcp-state="hosted|desktop|self-hosted"]`, and
 * the three states differ ONLY in the endpoint and whether a token is required.
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
  await page.goto('/?blank=1');
  await page.waitForSelector('.app');
  await page.locator('.rail__button[aria-label="Tools"]').click();
  await page.waitForTimeout(500);
}

/** Pretend nothing advertises MCP: the hosted state. */
async function asHosted(page: Page) {
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

test('B34a with no advertisement the panel offers the hosted endpoint and a session token', async ({
  page,
}) => {
  await asHosted(page);
  await openTools(page);

  await expect(panel(page)).toHaveAttribute('data-mcp-state', 'hosted');
  // The hosted endpoint is offered, not a dead end: same panel as the others.
  await expect(panel(page)).toContainText('https://getpigma.com/mcp');
  await expect(page.locator('input[aria-label="MCP endpoint"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="mcp-bridge-panel"]')).toHaveCount(1);
  await expect(page.locator('button', { hasText: /connect mcp/i })).toHaveCount(1);
  // The hosted endpoint needs a token, and the panel offers to mint one.
  await expect(page.locator('button[aria-label="Get a session token"]')).toHaveCount(1);

  // Nothing points at a download any more.
  const text = (await panel(page).textContent()) ?? '';
  expect(text, `hosted panel still offers a download: ${text.slice(0, 240)}`).not.toMatch(
    /not offered|download the app/i,
  );
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
 * yields self-hosted). The desktop state therefore cannot be reached from a
 * browser spec - it needs the shell.
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
