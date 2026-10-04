import { test, expect, connectEditor, mcpCall, type RelayInfo } from './relay';
import { drawShape, field, docToScreen } from './helpers';

/**
 * The outline MCP reports for the CURRENT SELECTION, including node NAMES.
 *
 * `get_metadata` with no nodeId outlines the current selection, so these
 * assertions run against MCP-side state rather than canvas geometry. This only
 * works once the relay mirrors THIS editor: a stale window reconnecting with a
 * known client id no longer steals the active slot (src/mcp/relay.ts), and
 * connectEditor waits until /bridge/status reports client 'pigma-editor'.
 */
async function mcpSelection(relay: RelayInfo): Promise<string> {
  const read = (await mcpCall(relay, 'tools/call', { name: 'get_metadata', arguments: {} })) as {
    result?: { content?: Array<{ text?: string }>; isError?: boolean };
  };
  if (read.result?.isError) throw new Error(`MCP read failed: ${read.result.content?.[0]?.text}`);
  return read.result?.content?.[0]?.text ?? '';
}

/**
 * NOTE ON TAB ORDER: BridgePanel is mounted only while the rail's Tools tab is
 * active and unmounting closes the client, so switching tabs drops the bridge.
 * These tests stay on the Tools tab once connected.
 */
test('B18a local edit, remote edit, undo, then remote read stay consistent', async ({
  page,
  relay,
}) => {
  // 1. Local edit through real pointer input, before connecting.
  await page.goto('/?blank=1');
  await page.waitForSelector('.app');
  await drawShape(page, 'Rectangle', 200, 120);
  const localName = (await page
    .locator('.layer-row--selected .layer-row__name')
    .first()
    .textContent())!;
  expect(localName).toBeTruthy();

  // 2. Connect; the Tools tab stays active from here on.
  await connectEditor(page, relay);

  // MCP itself reports the locally edited node, by name.
  await expect.poll(() => mcpSelection(relay), { timeout: 10000 }).toContain(localName);

  // 3. Remote edit through MCP -> relay -> the live editor.
  const remote = (await mcpCall(relay, 'tools/call', {
    name: 'use_pigma',
    arguments: {
      code: `const r = figma.createRectangle();
r.name = 'Remote Node';
r.x = 40; r.y = 40; r.resize(120, 80);
figma.currentPage.appendChild(r);
figma.currentPage.selection = [r];`,
    },
  })) as { result?: { isError?: boolean } };
  expect(remote.result?.isError ?? false, JSON.stringify(remote).slice(0, 200)).toBe(false);

  // MCP outlines the SELECTION, so select the remote node on canvas first.
  const remoteCentre = await docToScreen(page, 40 + 60, 40 + 40);
  await page.mouse.click(remoteCentre.x, remoteCentre.y);
  await expect.poll(() => mcpSelection(relay), { timeout: 10000 }).toContain('Remote Node');

  // 4. Undo inside the editor.
  await page.keyboard.press('Control+z');

  // MCP's own view drops the remote node...
  await expect.poll(() => mcpSelection(relay), { timeout: 10000 }).not.toContain('Remote Node');
  // ...and the local node is still there, by name.
  const localCentre = await docToScreen(page, 352 + 100, 390 + 60);
  await page.mouse.click(localCentre.x, localCentre.y);
  await expect.poll(() => mcpSelection(relay), { timeout: 10000 }).toContain(localName);
});

test('B18b a remote edit after a local move keeps both changes', async ({ page, relay }) => {
  await page.goto('/?blank=1');
  await page.waitForSelector('.app');
  await drawShape(page, 'Rectangle', 200, 120);
  const localName = (await page
    .locator('.layer-row--selected .layer-row__name')
    .first()
    .textContent())!;
  const before = Number(await field(page, 'X').inputValue());

  // Local move.
  const box = (await page.locator('.canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 60, cy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  expect(Number(await field(page, 'X').inputValue())).not.toBe(before);

  await connectEditor(page, relay);

  const remote = (await mcpCall(relay, 'tools/call', {
    name: 'use_pigma',
    arguments: {
      code: `const r = figma.createRectangle();
r.name = 'Remote Node 2';
r.x = 10; r.y = 10; r.resize(60, 60);
figma.currentPage.appendChild(r);
figma.currentPage.selection = [r];`,
    },
  })) as { result?: { isError?: boolean } };
  expect(remote.result?.isError ?? false).toBe(false);

  const remoteCentre = await docToScreen(page, 10 + 30, 10 + 30);
  await page.mouse.click(remoteCentre.x, remoteCentre.y);
  await expect.poll(() => mcpSelection(relay), { timeout: 10000 }).toContain('Remote Node 2');

  // Undo the remote edit; the local node is still reported by name.
  await page.keyboard.press('Control+z');
  const localCentre = await docToScreen(page, before + 100, 390 + 60);
  await page.mouse.click(localCentre.x, localCentre.y);
  await expect.poll(() => mcpSelection(relay), { timeout: 10000 }).toContain(localName);
});
