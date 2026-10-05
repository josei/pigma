/**
 * The bridge command timeout: what it is FOR, and what it must not do.
 *
 * The intent is LIVENESS — the relay's own comment says "their editor is gone or
 * stalled". But nothing in the protocol can tell "stalled" from "busy": the editor
 * sends no progress while it runs a command, and the only heartbeat is
 * server -> client. So the timer was the sole watcher, and at 10 s it killed
 * healthy work under load (the browser suite's B11d: `setFile` timed out and the
 * import never completed).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { figmaRestToPigmaFile } from '../../src/figma/convert/convert';
import { parseFigmaRestFile } from '../../src/figma/rest/parse';
import { DEFAULT_COMMAND_TIMEOUT_MS, startRelayServer } from '../../src/mcp/relay';
import { FakeBrowser } from './fakeEditor';
import type { PigmaFile } from '../../src/model/types';

const json = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../figma/fixtures/${name}`, import.meta.url)), 'utf8'));

function initialFile(): PigmaFile {
  return figmaRestToPigmaFile(parseFigmaRestFile(json('rest-file.json')), { now: () => 1 }).file;
}

describe('the bridge command timeout', () => {
  it('is defined once, and the CLI default is that same value', () => {
    // The number used to appear TWICE — `relay.ts`'s fallback and `bin.ts`'s CLI
    // default — and the CLI's literal shadowed the relay's, so changing one would
    // silently not change the other.
    const source = readFileSync(fileURLToPath(new URL('../../src/mcp/bin.ts', import.meta.url)), 'utf8');
    expect(source).not.toMatch(/relayTimeoutMs:\s*[0-9_]+/);
    expect(source).toContain('DEFAULT_COMMAND_TIMEOUT_MS');
    // The work is a whole document import plus a settle, so the budget must be well
    // above the 10 s that killed it under load.
    expect(DEFAULT_COMMAND_TIMEOUT_MS).toBeGreaterThanOrEqual(30_000);
  });

  it('fires on a budget too small for the work, naming the command', async () => {
    // A DELIBERATE reproduction: the fake editor answers asynchronously, so a 1 ms
    // budget cannot cover it. This is the mechanism that hit B11d.
    const relay = await startRelayServer({ token: 'too-small', commandTimeoutMs: 1 });
    try {
      const browser = new FakeBrowser(relay.url, relay.token, initialFile());
      await browser.waitUntil(() => relay.status().connected);
      // `setFile` is the command B11d died on: it does the whole document write.
      await expect(relay.session.setFile(initialFile())).rejects.toThrow(/timed out after 1 ms/);
    } finally {
      await relay.close();
    }
  });

  it('does NOT fire on the default budget for the same command', async () => {
    // The same work, under the real default: it completes. That is the fix — the
    // default no longer kills healthy work, and a genuine hang still fails, because
    // the bound is real, just not smaller than the work.
    const relay = await startRelayServer({ token: 'default-budget' });
    try {
      const browser = new FakeBrowser(relay.url, relay.token, initialFile());
      await browser.waitUntil(() => relay.status().connected);
      // The same command, under the default budget: it completes.
      await relay.session.setFile(initialFile());
      expect(relay.session.getFile()).not.toBeNull();
    } finally {
      await relay.close();
    }
  });
});
