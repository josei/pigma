/**
 * Relay entry point: serve the built static assets and run the collaboration
 * relay. One entry, three cases — a deployment (environment only), a local relay
 * for the editor or a browser test (flags), or a throwaway in-memory relay.
 *
 *   npm run relay -- --port 8788 --host 127.0.0.1 --no-data
 *
 * Launch it from the local `vite-node` binary (which is what the npm script does)
 * rather than through `npx`: `npx` adds an npm/sh wrapper layer whose children
 * outlive a SIGTERM and linger as orphans.
 *
 * All the wiring lives in `server/deployment.ts`, so tests can start the same
 * deployment in-process instead of spawning this file. Flags and environment are
 * documented in `server/args.ts` (`--help` prints them); the operator-facing story
 * is in `docs/SELF_HOSTING.md`.
 */
import { CONFIG_PATH } from './config';
import { startDeployment } from './deployment';
import { RELAY_USAGE, parseRelayArgs, relayBanner, type RelayOptions } from './args';

// Captured before anything can await: if the parent goes away while we start
// up, comparing against a parent captured later would miss it entirely.
const initialParent = process.ppid;

const options: RelayOptions = (() => {
  try {
    return parseRelayArgs(process.argv.slice(2), process.env);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return process.exit(2);
  }
})();

if (options.help) {
  process.stdout.write(RELAY_USAGE);
  process.exit(0);
}

const deployment = await startDeployment({
  port: options.port,
  host: options.host,
  ...(options.staticDir !== undefined ? { staticDir: options.staticDir } : {}),
  ...(options.dataDir !== undefined ? { dataDir: options.dataDir } : {}),
  ...(options.token !== undefined ? { token: options.token } : {}),
  limits: options.limits,
  mcp: options.mcp,
  mcpPath: options.mcpPath,
  ...(options.mcpToken !== undefined ? { mcpToken: options.mcpToken } : {}),
  ...(options.tokenTtlMs !== undefined ? { tokenTtlMs: options.tokenTtlMs } : {}),
  bridge: options.hosted,
  bridgePath: options.bridgePath,
  ...(options.bridgeToken !== undefined ? { bridgeToken: options.bridgeToken } : {}),
});

const hasStatic = options.staticDir !== undefined;
for (const line of relayBanner(options, deployment.port, hasStatic)) console.log(line);
if (deployment.bridgeToken) {
  // Operator-only output, exactly like `pigma mcp --bridge`: the editor needs
  // this URL to connect, and it must not be advertised publicly.
  console.log(`  bridge endpoint: ${deployment.httpBase}${options.bridgePath}/events?token=${deployment.bridgeToken}`);
}
// A single machine-readable line, so a test or a supervisor can wait for the URL
// instead of scraping the banner.
console.log(
  `relay ready ${JSON.stringify({
    url: deployment.httpBase,
    port: deployment.port,
    config: `${deployment.httpBase}${CONFIG_PATH}`,
    ...(options.mcp ? { mcp: `${deployment.httpBase}${options.mcpPath}` } : {}),
  })}`,
);

let stopping = false;
const shutdown = async (signal: string): Promise<void> => {
  if (stopping) return;
  stopping = true;
  console.log(`relay stopping (${signal})`);
  await deployment.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

if (options.orphanGuard) {
  // Nothing will ever signal a relay whose parent has gone: `npm run relay`
  // spawned through npm/sh leaves exactly that behind, because npm does not
  // forward SIGTERM to the script it started. Reparenting is the reliable
  // signal that the supervisor is gone, so exit instead of lingering.
  const guard = setInterval(() => {
    if (process.ppid !== initialParent) void shutdown('orphaned');
  }, 2000);
  guard.unref();
}
