#!/usr/bin/env node
/**
 * Prepare the desktop app's sidecar : the bundled MCP server and relay, and a
 * Node runtime to run them. Output goes to `src-tauri/sidecar/`, which Tauri ships as a
 * resource. Run before `tauri build`; the build fails if the folder is missing.
 *
 * The runtime is a copy of the Node that runs this script, so CI needs no extra download:
 * on each runner that is that platform's own Node binary.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join('src-tauri', 'sidecar');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const built = spawnSync(process.execPath, ['scripts/build-servers.mjs'], { stdio: 'inherit' });
if (built.status !== 0) process.exit(built.status ?? 1);

for (const file of ['relay.mjs', 'mcp.mjs']) copyFileSync(join('dist-servers', file), join(OUT, file));
copyFileSync(join('scripts', 'sidecar-supervisor.mjs'), join(OUT, 'supervisor.mjs'));
cpSync(join('dist-servers', 'node_modules'), join(OUT, 'node_modules'), { recursive: true });

const runtime = join(OUT, process.platform === 'win32' ? 'node.exe' : 'node');
copyFileSync(process.execPath, runtime);
chmodSync(runtime, 0o755);
// Symbols are not needed to run Node: stripping saves about 17 MB here. Linux only for now;
// the other platforms ship the unstripped copy until they are tested.
if (process.platform === 'linux') {
  const stripped = spawnSync('strip', [runtime], { stdio: 'inherit' });
  if (stripped.status !== 0) console.warn('sidecar: strip failed; shipping the unstripped runtime');
}
console.log(`sidecar: ${OUT}/ holds relay.mjs, mcp.mjs, the rasterizer and the Node runtime`);
