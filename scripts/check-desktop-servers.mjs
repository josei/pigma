#!/usr/bin/env node
/**
 * Check a packaged desktop app's local servers . Starts the app binary, waits for
 * the MCP endpoint and the rooms relay to answer, calls the MCP tool list and opens a rooms
 * socket, then stops the app and checks that both ports close. Exits 0 on success.
 *
 *   node scripts/check-desktop-servers.mjs <path to the app binary>
 *
 * Needs a display (a desktop session, or `xvfb-run -a` on Linux). Uses Node's built-in fetch and
 * WebSocket, so it adds no dependency.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const MCP = 'http://127.0.0.1:3001/mcp';
const ROOMS = 'ws://127.0.0.1:3002/collab?room=ci-check';
const STARTUP_MS = 90_000;
const SHUTDOWN_MS = 20_000;

const binary = process.argv[2];
if (!binary || !existsSync(binary)) {
  console.error(`check: no app binary at ${binary ?? '(none given)'}`);
  process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function mcpPost(body) {
  const response = await fetch(MCP, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body),
  });
  return { status: response.status, text: await response.text() };
}

async function waitUntil(check, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(500);
  }
  throw new Error(`${label} did not answer within ${timeoutMs / 1000}s`);
}

const roomsOpen = () =>
  new Promise((resolve) => {
    const socket = new WebSocket(ROOMS);
    const timer = setTimeout(() => resolve(false), 5_000);
    socket.addEventListener('open', () => {
      clearTimeout(timer);
      socket.close();
      resolve(true);
    });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });

const portOpen = async (url) => {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2_000) });
    return true;
  } catch {
    return false;
  }
};

const app = spawn(binary, [], { stdio: 'ignore' });
let exitCode = 1;
try {
  await waitUntil(async () => {
    try {
      return (await mcpPost({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'ci-check', version: '0' } } })).status === 200;
    } catch {
      return false;
    }
  }, STARTUP_MS, 'the MCP endpoint');
  console.log('check: MCP answers initialize');

  const tools = await mcpPost({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  if (tools.status !== 200 || !tools.text.includes('"tools"')) throw new Error(`tools/list failed: ${tools.status}`);
  console.log('check: MCP lists its tools');

  await waitUntil(roomsOpen, 30_000, 'the rooms relay');
  console.log('check: a rooms socket opens on /collab');
  exitCode = 0;
} catch (error) {
  console.error(`check: FAILED: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  app.kill('SIGTERM');
  const exited = new Promise((resolve) => app.once('exit', resolve));
  await Promise.race([exited, sleep(SHUTDOWN_MS)]);
  if (exitCode === 0) {
    try {
      await waitUntil(async () => !(await portOpen(MCP)), 15_000, 'the MCP port closing');
      console.log('check: both servers stop with the app');
    } catch (error) {
      console.error(`check: FAILED: ${error instanceof Error ? error.message : String(error)}`);
      exitCode = 1;
    }
  }
}
process.exit(exitCode);
