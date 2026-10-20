#!/usr/bin/env node
/**
 * Build the local MCP server and the collaboration relay as standalone bundles, for the
 * desktop app's sidecar (ROADMAP M17). The output is `dist-servers/`:
 *
 *   relay.mjs, mcp.mjs     the two servers, bundled with their TypeScript dependencies
 *   node_modules/@resvg/   the native rasterizer, which stays external (it ships a
 *                          binary per platform and cannot be bundled)
 *
 * Run them with a Node runtime from inside `dist-servers/`, so the rasterizer resolves.
 */
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'dist-servers';
// Bundled CommonJS dependencies call `require`; give the ESM bundle a real one.
const REQUIRE_SHIM =
  'import { createRequire as __pigmaRequireFactory } from "node:module"; const require = __pigmaRequireFactory(import.meta.url);';

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (const [name, entry] of [
  ['relay', 'server/index.ts'],
  ['mcp', 'src/mcp/bin.ts'],
]) {
  await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['@resvg/resvg-js'],
    banner: { js: REQUIRE_SHIM },
    outfile: join(OUT, `${name}.mjs`),
    logLevel: 'warning',
  });
}

cpSync('node_modules/@resvg', join(OUT, 'node_modules', '@resvg'), { recursive: true });
console.log(`servers: built relay.mjs and mcp.mjs into ${OUT}/`);
