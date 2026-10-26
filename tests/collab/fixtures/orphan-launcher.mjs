/**
 * Test fixture: start a relay, report where it is and what it is, then exit
 * while leaving the relay running.
 *
 * Used by `tests/collab/relay-cli.test.ts` to prove the relay's orphan guard: a
 * relay whose parent goes away must exit by itself, because nothing will ever
 * signal it again. The relay's **pid** is reported so the test can wait on the
 * real condition — that process being gone — instead of probing the port or
 * shelling out to `lsof` (both of which are load-sensitive).
 *
 *   node tests/collab/fixtures/orphan-launcher.mjs <vite-node> <repoRoot>
 *
 * Prints one line: {"port":<n>,"pid":<n>}
 */
import { spawn } from 'node:child_process';

const [viteNode, repoRoot] = process.argv.slice(2);
if (!viteNode || !repoRoot) {
  process.stderr.write('usage: orphan-launcher.mjs <vite-node> <repoRoot>\n');
  process.exit(2);
}

const relay = spawn(viteNode, ['server/index.ts', '--port', '0', '--host', '127.0.0.1', '--no-data', '--no-static'], {
  cwd: repoRoot,
  stdio: ['ignore', 'pipe', 'inherit'],
});

let out = '';
relay.stdout.on('data', (chunk) => {
  out += chunk.toString('utf8');
  const match = /relay ready (\{[^}]*\})/.exec(out);
  if (!match) return;
  // Report the port and the relay's pid, then leave: the relay is orphaned from
  // here on, and the test watches its pid disappear.
  console.log(JSON.stringify({ port: JSON.parse(match[1]).port, pid: relay.pid }));
  setTimeout(() => process.exit(0), 100);
});
