#!/usr/bin/env node
/**
 * The REAL IPC hop.
 *
 * B34d (`tests/browser/b34-mcp-gating.spec.ts`) proves the panel's state
 * handling with `window.__TAURI__` injected by the spec. This script proves the
 * other half: that the actual Tauri shell exposes the bridge the panel reads and
 * that `desktop_info` answers through it.
 *
 * It launches the real shell under a virtual display and drives it with
 * WebDriver — `tauri-driver` (Rust side) proxying to `WebKitWebDriver` (ships in
 * `webkit2gtk-driver`) — then:
 *   1. reports what `window.__TAURI__` actually is inside the webview,
 *   2. invokes `desktop_info` over the genuine IPC,
 *   3. opens the Tools rail and reads the panel's `data-mcp-state`.
 *
 * Requirements (none of these ship in package.json):
 *   - `cargo build` in `src-tauri/` (the shell binary),
 *   - `xvfb-run` (or any X display), `WebKitWebDriver`, and `tauri-driver`
 *     (`cargo install tauri-driver --locked`).
 *
 * Run:  xvfb-run -a node tests/desktop/ipc-hop.mjs [--binary <path>]
 * Exit: 0 when the desktop state is reached through the real hop, 1 otherwise.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const DEFAULT_BINARY = resolve(ROOT, 'src-tauri/target/debug/pigma-desktop');
const DRIVER_PORT = 4444;
const NATIVE_PORT = 4445;

const argOf = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
};
const BINARY = resolve(argOf('--binary', DEFAULT_BINARY));
const TAURI_DRIVER = resolve(process.env.HOME ?? '', '.cargo/bin/tauri-driver');

/** A named failure: thrown, never `process.exit`, so `finally` can close the
 *  WebDriver session (WebKitWebDriver allows only one active session, and a
 *  leaked one makes every later run fail with "Maximum number of active
 *  sessions"). */
class StepFailure extends Error {
  constructor(step, detail) {
    super(`${step}: ${detail}`);
  }
}
const fail = (step, detail) => {
  throw new StepFailure(step, detail);
};
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function waitForDriver(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${DRIVER_PORT}/status`);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  throw new Error(`tauri-driver did not answer on :${DRIVER_PORT} within ${timeoutMs}ms`);
}

async function command(sessionId, path, body) {
  const response = await fetch(`http://127.0.0.1:${DRIVER_PORT}/session/${sessionId}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (payload.value?.error) throw new Error(`${path}: ${payload.value.error} ${payload.value.message ?? ''}`);
  return payload.value;
}

/** Run an async script in the page (W3C: last argument is the done callback). */
const asyncScript = (sessionId, script) => command(sessionId, '/execute/async', { script, args: [] });

const PROBE = `
const done = arguments[arguments.length - 1];
const tauri = window.__TAURI__;
const invoke = tauri && (tauri.core && tauri.core.invoke ? tauri.core.invoke : tauri.invoke);
done({
  readyState: document.readyState,
  title: document.title,
  tauriGlobal: typeof tauri,
  invoke: typeof invoke,
  hasToolsRail: !!document.querySelector('.rail__button[aria-label="Tools"]'),
});
`;

const INVOKE_INFO = `
const done = arguments[arguments.length - 1];
const tauri = window.__TAURI__;
const invoke = tauri && (tauri.core && tauri.core.invoke ? tauri.core.invoke : tauri.invoke);
if (typeof invoke !== 'function') return done({ invoke: 'absent' });
invoke('desktop_info')
  .then((info) => done({ invoke: 'ok', info }))
  .catch((error) => done({ invoke: 'error', error: String(error) }));
`;

const PANEL_STATE = `
const done = arguments[arguments.length - 1];
const rail = document.querySelector('.rail__button[aria-label="Tools"]');
if (!rail) return done({ state: null, reason: 'no Tools rail' });
rail.click();
let tries = 0;
const read = () => {
  const panel = document.querySelector('[data-testid="mcp-panel"]');
  const state = panel && panel.getAttribute('data-mcp-state');
  if (state) return done({ state, endpoint: panel.getAttribute('data-mcp-endpoint') });
  if (++tries > 120) return done({ state: null, reason: 'panel never rendered a state' });
  setTimeout(read, 50);
};
read();
`;

async function main() {
  if (!existsSync(BINARY)) fail('build', `no shell binary at ${BINARY} (run \`cargo build\` in src-tauri/)`);
  if (!existsSync(TAURI_DRIVER)) fail('tauri-driver', `not found at ${TAURI_DRIVER} (cargo install tauri-driver --locked)`);
  if (!process.env.DISPLAY) fail('display', 'DISPLAY is unset — run under `xvfb-run -a`');

  const driver = spawn(TAURI_DRIVER, ['--port', String(DRIVER_PORT), '--native-port', String(NATIVE_PORT), '--native-driver', '/usr/bin/WebKitWebDriver'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}` },
  });
  const driverLog = [];
  driver.stdout.on('data', (chunk) => driverLog.push(String(chunk)));
  driver.stderr.on('data', (chunk) => driverLog.push(String(chunk)));

  let sessionId = null;
  try {
    await waitForDriver();
    console.log(`ok    tauri-driver up on :${DRIVER_PORT} (native :${NATIVE_PORT})`);

    const response = await fetch(`http://127.0.0.1:${DRIVER_PORT}/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ capabilities: { alwaysMatch: { 'tauri:options': { application: BINARY } } } }),
    });
    const payload = await response.json();
    sessionId = payload.value?.sessionId;
    if (!sessionId) fail('session', `tauri-driver refused the session: ${JSON.stringify(payload.value)}`);
    console.log(`ok    WebDriver session opened, the shell launched`);

    // The app loads its embedded bundle; give the editor a moment to mount.
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const probe = await asyncScript(sessionId, PROBE);
      if (probe.hasToolsRail) break;
      await sleep(500);
      if (attempt === 59) console.log(`warn  the Tools rail never appeared; probe: ${JSON.stringify(probe)}`);
    }

    const probe = await asyncScript(sessionId, PROBE);
    console.log(`probe ${JSON.stringify(probe)}`);

    const info = await asyncScript(sessionId, INVOKE_INFO);
    console.log(`ipc   ${JSON.stringify(info)}`);

    const panel = await asyncScript(sessionId, PANEL_STATE);
    console.log(`panel ${JSON.stringify(panel)}`);

    if (probe.tauriGlobal !== 'object') fail('window.__TAURI__', `the webview reports ${probe.tauriGlobal}, so the panel's readDesktopInfo returns null`);
    if (info.invoke !== 'ok') fail('desktop_info', `the real IPC answered ${JSON.stringify(info)}`);
    if (panel.state !== 'desktop') fail('panel state', `expected "desktop", got ${JSON.stringify(panel)}`);
    console.log('PASS  the desktop state was reached through the real IPC hop');
    return 0;
  } catch (error) {
    console.log(`driver log:\n${driverLog.join('')}`);
    console.log(`FAIL  ${error instanceof StepFailure ? error.message : `hop: ${String(error)}`}`);
    return 1;
  } finally {
    // Close the session before killing the driver: a leaked session survives the
    // driver and WebKitWebDriver then refuses every later run.
    if (sessionId) {
      await fetch(`http://127.0.0.1:${DRIVER_PORT}/session/${sessionId}`, { method: 'DELETE' }).catch(() => {});
    }
    driver.kill('SIGTERM');
  }
}

// The pre-flight checks throw before `main`'s try block, so the top level
// reports them too rather than letting an unhandled rejection print a stack.
try {
  process.exit(await main());
} catch (error) {
  console.log(`FAIL  ${error instanceof StepFailure ? error.message : `hop: ${String(error)}`}`);
  process.exit(1);
}
