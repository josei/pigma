import { test, expect, connectEditor, relayIsAlive, mcpCall } from './relay';
import { setTimeout as delay } from 'node:timers/promises';

/**
 * The relay must survive commands that do not answer promptly.
 *
 * These tests are deliberately NOT marked as expected failures: they fail
 * visibly until the crash is fixed, so the regression cannot be parked.
 *
 * Reported crash (src/mcp/relay.ts:82):
 *   McpToolError: Bridge command "setFile" timed out after 10000 ms
 *   at Timeout._onTimeout -> process exits 1
 * One unanswered command takes the relay AND the MCP HTTP server down for
 * every other client.
 */

/**
 * The root config allows 30s, which is below relay start-up plus the relay's
 * 10s command timeout, so these get a real budget rather than a weaker check.
 */
test.describe.configure({ timeout: 90_000 });

/** Longer than the relay's 10s per-command timeout. */
const PAST_COMMAND_TIMEOUT = 12000;

/** Read once so the next write is not rejected for carrying a stale revision. */
async function freshenSnapshot(relay: Parameters<typeof mcpCall>[0]) {
  await mcpCall(relay, 'tools/call', { name: 'get_metadata', arguments: {} });
}

test('B17a the relay survives a bridged command that succeeded', async ({ page, relay }) => {
  await connectEditor(page, relay);
  await freshenSnapshot(relay);

  const result = await mcpCall(relay, 'tools/call', {
    name: 'create_new_file',
    arguments: { name: 'Crash QA' },
  });
  expect(JSON.stringify(result)).not.toContain('timed out');

  // A leaked timeout timer would reject an already-settled promise and Node
  // exits on the unhandled rejection, so wait past the window.
  await delay(PAST_COMMAND_TIMEOUT);
  expect(await relayIsAlive(relay)).toBe(true);
});

test('B17b the relay survives a command with no editor attached', async ({ page, relay }) => {
  await page.goto('/');
  await page.waitForSelector('.app');

  const result = (await mcpCall(relay, 'tools/call', {
    name: 'create_new_file',
    arguments: { name: 'No editor' },
  })) as { result?: { isError?: boolean; content?: Array<{ text?: string }> } };

  expect(result.result?.isError).toBe(true);
  expect(result.result?.content?.[0]?.text ?? '').toMatch(/no editor|not connected/i);

  await delay(PAST_COMMAND_TIMEOUT);
  expect(await relayIsAlive(relay)).toBe(true);
});

/**
 * Deterministic timeout repro: stall the editor's ACK.
 *
 * The editor answers a bridged command by POSTing to /bridge/result on the
 * relay. Intercepting that POST and never fulfilling it means the relay's
 * per-command timeout is guaranteed to fire — no dependence on slow scripts or
 * on winning a race with a disconnect.
 */
test('B17c a stalled ACK times out the command without killing the relay', async ({
  page,
  relay,
}) => {
  await connectEditor(page, relay);
  await freshenSnapshot(relay);

  let held = 0;
  await page.route('**/bridge/result', async () => {
    // Hold the ACK forever: the relay must give up on its own.
    held += 1;
  });

  try {
    await freshenSnapshot(relay);
    const result = (await mcpCall(relay, 'tools/call', {
      name: 'create_new_file',
      arguments: { name: 'Stalled ACK' },
    })) as { result?: { isError?: boolean; content?: Array<{ text?: string }> } };
    console.log('stalled command ->', JSON.stringify(result).slice(0, 240));

    // The tool must report the timeout explicitly rather than hanging.
    expect(held).toBeGreaterThan(0);
    expect(result.result?.isError).toBe(true);
    expect(result.result?.content?.[0]?.text ?? '').toMatch(/timed out|timeout/i);
  } finally {
    // Always restore interception, even if an assertion above failed.
    await page.unroute('**/bridge/result');
  }

  // The process must still be serving...
  expect(await relayIsAlive(relay)).toBe(true);

  // ...and the connection must still work afterwards.
  const after = (await mcpCall(relay, 'tools/call', { name: 'get_metadata', arguments: {} })) as {
    result?: { isError?: boolean };
  };
  expect(after.result?.isError ?? false).toBe(false);
});

test('B17d a write issued immediately after connecting succeeds', async ({ page, relay }) => {
  await connectEditor(page, relay);

  // Deliberately NO prior read: the session snapshot must already match the
  // editor, otherwise the first write from a fresh client is lost as stale.
  const result = (await mcpCall(relay, 'tools/call', {
    name: 'create_new_file',
    arguments: { name: 'Immediate write' },
  })) as { result?: { isError?: boolean; content?: Array<{ text?: string }> } };

  const text = result.result?.content?.[0]?.text ?? '';
  expect(text, `first write after connect was rejected: ${text}`).not.toMatch(/stale revision/i);
  expect(result.result?.isError ?? false).toBe(false);
});

test('B17e the relay survives the editor disconnecting mid-flight', async ({ page, relay }) => {
  await connectEditor(page, relay);
  await freshenSnapshot(relay);

  const pending = mcpCall(relay, 'tools/call', {
    name: 'create_new_file',
    arguments: { name: 'Mid-flight' },
  }).catch(() => null);
  await page.locator('[data-testid="mcp-bridge-panel"] button', { hasText: 'Disconnect' }).click();
  await page.close();
  await pending;

  await delay(PAST_COMMAND_TIMEOUT);
  expect(await relayIsAlive(relay)).toBe(true);
});
