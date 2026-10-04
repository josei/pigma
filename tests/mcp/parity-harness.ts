/**
 * Harness for the parity matrix: a live editor on a bridge, an MCP server bound
 * to it, and a real MCP SDK client over Streamable HTTP.
 *
 * Each tool is exercised against a *pristine* document — several tools mutate
 * the file (create_new_file, use_pigma, upload_assets, generate_diagram), so
 * without a reset between calls the matrix would test the leftovers of the
 * previous tool rather than the tool itself.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { figmaRestToPigmaFile } from '../../src/figma/convert/convert';
import { parseFigmaRestFile } from '../../src/figma/rest/parse';
import type { PigmaFile } from '../../src/model/types';
import { createMcpServer } from '../../src/mcp/protocol';
import { startRelayServer, type RelayHandle } from '../../src/mcp/relay';
import { startHttpServer, type HttpServerHandle } from '../../src/mcp/transports/node';
import { FakeBrowser } from './fakeEditor';

export function initialFile(): PigmaFile {
  const raw = JSON.parse(
    readFileSync(fileURLToPath(new URL('../figma/fixtures/rest-file.json', import.meta.url)), 'utf8'),
  ) as unknown;
  return figmaRestToPigmaFile(parseFigmaRestFile(raw), { now: () => 1 }).file;
}

export interface ParityHarness {
  client: Client;
  /** Restore the editor's document and selection to the pristine fixture. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

export async function startParityHarness(): Promise<ParityHarness> {
  const relay: RelayHandle = await startRelayServer({ token: 'parity-token', commandTimeoutMs: 30_000 });
  const server: HttpServerHandle = await startHttpServer(createMcpServer({ session: relay.session }));
  const browser = new FakeBrowser(relay.url, relay.token, initialFile());
  await browser.waitUntil(() => relay.status().connected);

  const client = new Client({ name: 'any-mcp-harness', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(server.url)));

  return {
    client,
    async reset() {
      await browser.localEdit(() => initialFile(), []);
    },
    async close() {
      await client.close().catch(() => undefined);
      browser.close();
      await server.close().catch(() => undefined);
      await relay.close().catch(() => undefined);
    },
  };
}
