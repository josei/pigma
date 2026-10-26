/**
 * Relay host fixture for the crash regression test.
 *
 * Runs a real relay + MCP HTTP server in a separate process so the test can
 * verify that an in-flight command that times out or loses its editor produces a
 * failed tool result **without killing the process**.
 *
 * Env: RELAY_TIMEOUT_MS (command timeout), default 300.
 */
import { createMcpServer } from '../../../src/mcp/protocol';
import { nodeRasterizer } from '../../../src/mcp/raster.node';
import { startRelayServer } from '../../../src/mcp/relay';
import { startHttpServer } from '../../../src/mcp/transports/node';

const timeoutMs = Number(process.env.RELAY_TIMEOUT_MS ?? 300);

const relay = await startRelayServer({ port: 0, token: 'spawn-token', commandTimeoutMs: timeoutMs });
const server = await startHttpServer(createMcpServer({ session: relay.session, rasterizer: nodeRasterizer }), { port: 0 });

process.stdout.write(`READY ${server.url} ${relay.url} spawn-token\n`);


const shutdown = async (): Promise<void> => {
  await server.close().catch(() => undefined);
  await relay.close().catch(() => undefined);
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
