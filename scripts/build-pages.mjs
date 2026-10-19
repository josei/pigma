#!/usr/bin/env node
/**
 * Build the static online copy for GitHub Pages: the landing page at the root and
 * the editor under app/, served from /<repo>/ with no server behind it.
 *
 * It sets two things the normal build does not: the static-site flag (sharing and
 * the AI agent degrade to a note, because there is no relay or MCP server), and the
 * base path the project page is served from. Both can be overridden from the
 * environment (PIGMA_BASE), which is how a fork on a different path would build it.
 */
import { spawnSync } from 'node:child_process';

const env = {
  ...process.env,
  VITE_PIGMA_STATIC: '1',
  PIGMA_BASE: process.env.PIGMA_BASE ?? '/pigma/',
};

// The desktop app updates from the Pages site, so the bundle manifest is built too.
for (const [command, args] of [
  ['npx', ['tsc', '-b']],
  ['npx', ['vite', 'build']],
  ['node', ['scripts/desktop-assets.mjs']],
]) {
  const result = spawnSync(command, args, { stdio: 'inherit', env, shell: process.platform === 'win32' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`pages: built the static site at ${env.PIGMA_BASE} into dist/`);
