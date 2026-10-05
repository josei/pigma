/**
 * Command-line entry point for the Pigma MCP server.
 *
 *   <ts-runner> src/mcp/bin.ts --file design.fig          # stdio transport
 *   <ts-runner> src/mcp/bin.ts --file file.json --http    # Streamable HTTP
 *
 * `--file` accepts a native `.fig`/`.deck`/`.jam` archive, a Figma REST JSON
 * response, or a Pigma document (`{"schema":"pigma/1", …}`). Omit it to start
 * with no document and use `create_new_file` over MCP.
 *
 * Writes are persisted: when the input is a Pigma JSON file, mutations are
 * saved back to it; otherwise pass `--out <path.json>` to persist to a new file.
 *
 * Node-only (uses `node:fs`/`node:zlib`); deliberately not exported from the
 * package barrel so browser bundles never include it.
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { validatePigmaFile } from '../model/validate';
import { parseFigmaRest } from '../figma/rest/parse';
import { toPigmaFile } from '../figma/convert/convert';
import { nodeDecompressors } from '../figma/native/node';
import { parseFigFile } from '../figma/native/parse';
import { exportFigBinary, zipArchive } from '../figma/native/export';
import { exportPigmaFile } from '../figma/native/modelExport';
import { nodeExportCompressors } from '../figma/native/export.node';
import type { PigmaFile } from '../model/types';
import { createMcpServer } from './protocol';
import { nodeRasterizer } from './raster.node';
import { settleDocument } from '../model/settle';
import { createSession, type DocumentSession } from './session';
import { createNodePluginInterpreter } from './plugin/interpreter.node';
import { DEFAULT_COMMAND_TIMEOUT_MS, startRelayServer } from './relay';
import { harnessConfigs } from './harnessConfig';
import { TokenStore } from './tokens';
import { startHttpServer } from './transports/node';
import { serveStdio, type StdioStreams } from './transports/stdio';

export interface CliOptions {
  file?: string;
  out?: string;
  http: boolean;
  bridge: boolean;
  port: number;
  relayPort: number;
  relayToken?: string;
  relayTimeoutMs: number;
  exportPath?: string;
  schemaFrom?: string;
  host: string;
  name: string;
  /** Hosted mode: require a minted, short-lived, revocable session token. */
  hosted: boolean;
  /** Session token lifetime in ms (hosted mode). Default 30 minutes. */
  tokenTtlMs?: number;
  /** Operator secret that allows minting from a non-loopback peer. */
  mintSecret?: string;
}

const INSTRUCTIONS =
  'Pigma MCP server. Read tools describe the open Pigma document; write tools edit it. ' +
  'THE DOCUMENT IS LOCAL TO THIS MACHINE: it is a local file, or the editor connected over the bridge. ' +
  'There is no Figma account, no Figma cloud, and no remote file involved — never fetch a design from figma.com; ' +
  'every tool here acts on the local document. ' +
  'The tool names, arguments and result shapes are Figma-compatible so Figma-style instructions and harnesses work unchanged, ' +
  'and the Figma Plugin API dialect is what use_pigma executes — in Pigma\'s own local sandbox, against the local document. ' +
  'See docs/MCP.md for the supported tool set and parity gaps.';

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    http: false,
    bridge: false,
    port: 3001,
    relayPort: 3002,
    relayTimeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
    host: '127.0.0.1',
    name: 'pigma',
    // Hosted mode is opt-in: loopback and self-host need no token at all.
    hosted: process.env.PIGMA_MCP_HOSTED === '1',
    ...(process.env.PIGMA_MCP_TOKEN_TTL_MS ? { tokenTtlMs: Number(process.env.PIGMA_MCP_TOKEN_TTL_MS) } : {}),
    ...(process.env.PIGMA_MCP_MINT_TOKEN ? { mintSecret: process.env.PIGMA_MCP_MINT_TOKEN } : {}),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--file' || arg === '-f') options.file = argv[++i];
    else if (arg === '--out' || arg === '-o') options.out = argv[++i];
    else if (arg === '--http') options.http = true;
    else if (arg === '--bridge') options.bridge = true;
    else if (arg === '--relay-port') options.relayPort = Number(argv[++i] ?? options.relayPort);
    else if (arg === '--relay-token') options.relayToken = argv[++i];
    else if (arg === '--relay-timeout') options.relayTimeoutMs = Number(argv[++i] ?? options.relayTimeoutMs);
    else if (arg === '--export') options.exportPath = argv[++i];
    else if (arg === '--schema-from') options.schemaFrom = argv[++i];
    else if (arg === '--port' || arg === '-p') options.port = Number(argv[++i] ?? options.port);
    else if (arg === '--host') options.host = argv[++i] ?? options.host;
    else if (arg === '--name') options.name = argv[++i] ?? options.name;
    else if (arg === '--hosted') options.hosted = true;
    else if (arg === '--token-ttl') options.tokenTtlMs = Number(argv[++i] ?? options.tokenTtlMs);
    else if (arg === '--mint-token') options.mintSecret = argv[++i];
    else if (arg === '--help' || arg === '-h') {
      throw new Error(
        'Usage: bin.ts [--file <path>] [--out <path>] [--http | --bridge] [--port <n>] [--hosted] [--token-ttl <ms>] [--mint-token <secret>] [--relay-port <n>] [--relay-token <t>] [--relay-timeout <ms>] [--export <out.fig>] [--schema-from <seed.fig>] [--host <addr>] [--name <id>]',
      );
    }
  }
  return options;
}

export type SourceKind = 'pigma' | 'rest' | 'native';

export interface LoadedDocument {
  file: PigmaFile;
  source: SourceKind;
  /** Non-fatal notes from validation/import. */
  warnings: string[];
}

/**
 * Load a document from a native `.fig` archive, a Figma REST response, or a
 * Pigma document. Pigma JSON is validated with the project validator; a file
 * that only *looks* like Pigma (schema tag present) is rejected.
 */
export function loadFile(path: string): LoadedDocument {
  const bytes = new Uint8Array(readFileSync(path));
  if (path.endsWith('.fig') || path.endsWith('.deck') || path.endsWith('.jam')) {
    const imported = toPigmaFile(parseFigFile(bytes, nodeDecompressors));
    return { file: imported.file, source: 'native', warnings: imported.report.warnings };
  }
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
  const looksPigma = typeof parsed === 'object' && parsed !== null && (parsed as { schema?: unknown }).schema === 'pigma/1';
  if (looksPigma) {
    const result = validatePigmaFile(parsed);
    if (!result.ok || !result.file) {
      throw new Error(`Invalid Pigma document: ${result.errors.join('; ')}`);
    }
    return { file: result.file, source: 'pigma', warnings: result.warnings };
  }
  const imported = toPigmaFile(parseFigmaRest(parsed));
  return { file: imported.file, source: 'rest', warnings: imported.report.warnings };
}

/**
 * Wrap a session so every write is persisted to `path` as Pigma JSON.
 *
 * The write is atomic (temp file + rename) and the in-memory document is only
 * committed **after** the disk write succeeds, so a failed save leaves the
 * session untouched and the tool reports the failure.
 */
export function createPersistingSession(session: DocumentSession, path: string): DocumentSession {
  return {
    getFile: () => session.getFile(),
    setFile: (file) => {
      // Persist what the session will hold, not the raw input: the session
      // settles derived geometry (auto-sized text, booleans), so writing first
      // and settling afterwards would leave the file on disk stale.
      const settled = settleDocument(file);
      const temp = `${path}.${process.pid}.tmp`;
      writeFileSync(temp, `${JSON.stringify(settled, null, 2)}\n`, 'utf8');
      renameSync(temp, path);
      session.setFile(settled);
    },
    getSelection: () => session.getSelection(),
    setSelection: (ids) => session.setSelection(ids),
  };
}

export interface RunCliIo {
  stdio?: StdioStreams;
  log?: (message: string) => void;
}

/** Start the server; resolves when the stdio transport finishes. */
export async function runCli(argv: string[], io: RunCliIo = {}): Promise<number> {
  const options = parseArgs(argv);
  const log = io.log ?? ((message: string) => process.stderr.write(`${message}\n`));

  let loaded: LoadedDocument | null = null;
  if (options.file) {
    loaded = loadFile(options.file);
    for (const warning of loaded.warnings) log(`warning: ${warning}`);
  }

  // Only Pigma JSON is written back in place. REST/native sources are imports:
  // they are never silently converted over the input file — use `--out`.
  const inPlace = loaded?.source === 'pigma' ? options.file : undefined;
  const savePath = options.out ?? inPlace;
  if (loaded && loaded.source !== 'pigma' && !options.out && !options.exportPath) {
    log(`warning: ${loaded.source} import is read-only; pass --out <path.json> to persist MCP writes`);
  }

  if (options.exportPath) {
    if (!options.file) throw new Error('--export requires --file <path>');
    const source = new Uint8Array(readFileSync(options.file));
    const isNative = /\.(fig|deck|jam)$/.test(options.file);
    if (!isNative) {
      // Editor-model export needs a real .fig for the wire schema.
      if (!options.schemaFrom) {
        throw new Error('Exporting a Pigma/Figma JSON document needs --schema-from <path.fig> (a real .fig providing the schema)');
      }
      const model = loadFile(options.file).file;
      const archive = await exportPigmaFile(model, {
        schemaFrom: new Uint8Array(readFileSync(options.schemaFrom)),
        decompress: nodeDecompressors,
        compress: nodeExportCompressors,
      });
      writeFileSync(options.exportPath, archive);
      log(`Exported ${options.file} -> ${options.exportPath} (schema from ${options.schemaFrom})`);
      return 0;
    }
    const doc = parseFigFile(source, nodeDecompressors);
    const canvas = await exportFigBinary(doc.message, {
      schemaFrom: source,
      decompress: nodeDecompressors,
      compress: nodeExportCompressors,
    });
    const entries: Array<[string, Uint8Array]> = [
      ['canvas.fig', canvas],
      ['meta.json', new TextEncoder().encode(JSON.stringify(doc.meta ?? { file_name: 'Exported', version: '1' }))],
    ];
    if (doc.thumbnail) entries.push(['thumbnail.png', doc.thumbnail]);
    for (const [name, bytes] of doc.images) entries.push([`images/${name}`, bytes]);
    writeFileSync(options.exportPath, zipArchive(entries));
    log(`Exported ${options.file} -> ${options.exportPath}`);
    return 0;
  }

  const base = createSession(loaded?.file ?? null);
  const session = savePath ? createPersistingSession(base, savePath) : base;
  const server = createMcpServer({ session, name: options.name, instructions: INSTRUCTIONS, rasterizer: nodeRasterizer });

  if (options.bridge) {
    const relay = await startRelayServer({ port: options.relayPort, token: options.relayToken, commandTimeoutMs: options.relayTimeoutMs });
    const bridgeServer = createMcpServer({
      session: relay.session,
      name: options.name,
      instructions: INSTRUCTIONS,
      rasterizer: nodeRasterizer,
      interpreter: createNodePluginInterpreter(),
    });
    const handle = await startHttpServer(bridgeServer, { port: options.port, host: options.host });
    log(`Pigma MCP server listening on ${handle.url}`);
    log(`Editor bridge: ${relay.url}/bridge/events?token=${relay.token}`);
    log(`Open the editor at: http://localhost:5173/bridge.html?relay=${relay.url}&token=${relay.token}`);
    return 0;
  }

  if (options.http) {
    const tokens = options.hosted
      ? new TokenStore(options.tokenTtlMs === undefined ? {} : { ttlMs: options.tokenTtlMs })
      : undefined;
    const handle = await startHttpServer(server, {
      port: options.port,
      host: options.host,
      name: options.name,
      ...(tokens ? { tokens } : {}),
      ...(options.mintSecret ? { mintSecret: options.mintSecret } : {}),
    });
    log(`Pigma MCP server listening on ${handle.url}`);
    log(`Status: ${handle.statusUrl}`);
    if (!tokens) {
      log('No session token required (loopback/self-host default). Use --hosted to require one.');
    } else {
      log(
        `Hosted mode: mint a session token with POST ${handle.url}/token ` +
          `(loopback or X-Pigma-Mint); TTL ${Math.round(tokens.lifetimeMs / 1000)}s; revoke with DELETE.`,
      );
    }
    // Printed for the CLI; the panel reads the same snippets from the status surface.
    for (const entry of harnessConfigs({ endpoint: handle.url, name: options.name })) {
      log(`${entry.label} (${entry.path}): ${entry.content.replace(/\n/g, ' ')}`);
    }
    return 0;
  }

  log(`Pigma MCP server ready on stdio${options.file ? ` (${options.file})` : ''}${savePath ? ` → ${savePath}` : ''}`);
  await serveStdio(server, io.stdio ?? { input: process.stdin, output: process.stdout });
  return 0;
}

// TypeScript runners (vite-node, tsx) set `process.argv[1]` to the runner
// binary, so comparing it with `import.meta.url` cannot detect direct
// execution. This module is an entry point only (never exported from the
// package barrel), so it runs unless a test runner or an explicit opt-out is
// present.
const isNode = typeof process !== 'undefined' && typeof process.argv !== 'undefined';
if (isNode && !process.env.VITEST && process.env.PIGMA_MCP_NO_RUN !== '1') {
  // A long-running bridge must not die from a stray rejection: the tool call
  // that caused it already returned an error, so log loudly and keep serving.
  //
  // Payload-safe by construction: an error *message* can quote the document (a
  // JSON parse error prints a snippet of its input), so only the error kind and
  // its first stack frame are logged — never the message.
  const location = (error: unknown): string => {
    const frame = error instanceof Error ? (error.stack ?? '').split('\n')[1]?.trim() : '';
    return frame ? `${error instanceof Error ? error.name : typeof error} at ${frame}` : error instanceof Error ? error.name : typeof error;
  };
  process.on('unhandledRejection', (reason) => {
    process.stderr.write(`[pigma-mcp] unhandled rejection: ${location(reason)}\n`);
  });
  process.on('uncaughtException', (error) => {
    process.stderr.write(`[pigma-mcp] uncaught exception: ${location(error)}\n`);
  });

  runCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
