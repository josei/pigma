import { test, expect, connectEditor, type RelayInfo } from './relay';
import type { Page } from '@playwright/test';

/**
 * The bridge panel is mounted under the Tools tab of the left rail.
 *
 * These tests run against a relay started per worker by ./relay.ts, so the
 * connection path is exercised by a plain `npm run test:browser` with no
 * external setup.
 */

async function openBridgePanel(page: Page) {
  await page.goto('/');
  await page.waitForSelector('.app');
  await page.locator('.rail__button[aria-label="Tools"]').click();
  const panel = page.locator('[data-testid="mcp-bridge-panel"]');
  await expect(panel).toBeVisible();
  return panel;
}

const status = (page: Page) => page.locator('[data-testid="mcp-bridge-status"]');

test('B16a the bridge panel is mounted and starts disconnected', async ({ page }) => {
  const panel = await openBridgePanel(page);

  await expect(status(page)).toHaveText(/disconnected/);
  // Connecting requires a token, so the button is inert until one is entered.
  const connect = panel.locator('button', { hasText: 'Connect MCP' });
  await expect(connect).toBeDisabled();
  await page.locator('input[aria-label="Relay token"]').fill('x');
  await expect(connect).toBeEnabled();
});

test('B16b an unreachable relay surfaces a user-visible error', async ({ page }) => {
  const panel = await openBridgePanel(page);

  // Port 9 is the discard port: nothing will answer.
  await page.locator('input[aria-label="Relay URL"]').fill('http://127.0.0.1:9');
  await page.locator('input[aria-label="Relay token"]').fill('irrelevant');
  await panel.locator('button', { hasText: 'Connect MCP' }).click();

  await expect(status(page)).toHaveText(/error/, { timeout: 15000 });
  // The failure reason is shown next to the status, not only in the console.
  await expect(panel).toContainText(/relay connection lost|failed|error/i);
});

test('B16c a wrong token is rejected with a visible error', async ({ page, relay }) => {
  const panel = await openBridgePanel(page);
  await page.locator('input[aria-label="Relay URL"]').fill(relay.url);
  await page.locator('input[aria-label="Relay token"]').fill('definitely-not-the-token');
  await panel.locator('button', { hasText: 'Connect MCP' }).click();

  await expect(status(page)).toHaveText(/error/, { timeout: 15000 });
});

test('B16d the editor connects to the relay and disconnects again', async ({ page, relay }) => {
  await connectEditor(page, relay);
  const panel = page.locator('[data-testid="mcp-bridge-panel"]');
  await expect(panel.locator('button', { hasText: 'Disconnect' })).toBeVisible();

  await panel.locator('button', { hasText: 'Disconnect' }).click();
  await expect(status(page)).toHaveText(/disconnected/);
});

test('B16e the relay reports which client is attached', async ({ page, relay, request }) => {
  await connectEditor(page, relay);

  // The relay registers the client as the SSE stream is accepted, which can
  // trail the UI flipping to "connected", so poll rather than read once.
  await expect
    .poll(
      async () => {
        const response = await request.get(`${relay.url}/bridge/status?token=${encodeURIComponent(relay.token)}`);
        const body = (await response.json()) as { connected: boolean; client: string | null };
        return `${body.connected}:${body.client}`;
      },
      { timeout: 10000 },
    )
    .toBe('true:pigma-editor');
});

test('B16f an unknown client name is still served, not rejected', async ({ page, relay }) => {
  await page.goto('/');
  await page.waitForSelector('.app');

  // `/bridge/events` is an SSE stream, so open it the way the app does.
  const outcome = await page.evaluate(
    ({ info }: { info: RelayInfo }) =>
      new Promise<string>((resolve) => {
        const source = new EventSource(
          `${info.url}/bridge/events?token=${encodeURIComponent(info.token)}&client=unknown-client`,
        );
        source.onopen = () => {
          source.close();
          resolve('open');
        };
        source.onerror = () => {
          source.close();
          resolve('error');
        };
        setTimeout(() => {
          source.close();
          resolve('timeout');
        }, 5000);
      }),
    { info: relay },
  );

  // The relay authorises on the token only; an unrecognised name is accepted.
  expect(outcome).toBe('open');
});
