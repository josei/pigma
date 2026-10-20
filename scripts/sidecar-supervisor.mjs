/**
 * The desktop sidecar's supervisor (ROADMAP M17). It runs the relay and the MCP server as
 * child processes, and stops them when its standard input closes. The desktop shell holds the
 * other end of that pipe, so the servers stop when the app exits, however it exits: a normal
 * quit, a SIGTERM, or a crash. A bare process would be left running as an orphan.
 *
 *   node supervisor.mjs --relay-port 3002 --mcp-port 3001
 */
import { spawn } from 'node:child_process';

const dir = import.meta.dirname;
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const relayPort = flag('--relay-port', '3002');
const mcpPort = flag('--mcp-port', '3001');

const children = [
  spawn(process.execPath, ['relay.mjs', '--port', relayPort, '--host', '127.0.0.1', '--no-data'], {
    cwd: dir,
    stdio: 'ignore',
  }),
  spawn(process.execPath, ['mcp.mjs', '--http', '--port', mcpPort, '--host', '127.0.0.1'], {
    cwd: dir,
    stdio: 'ignore',
  }),
];

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(0), 1000).unref();
  for (const child of children) child.once('exit', () => {
    if (children.every((c) => c.exitCode !== null || c.signalCode !== null)) process.exit(0);
  });
}

// The parent holds the other end of this pipe for as long as it runs.
process.stdin.resume();
process.stdin.on('end', stop);
process.stdin.on('close', stop);
