/**
 * Global setup for the browser suite: makes sure `dist/` is a build of the current sources before any test runs. The offline
 * and service-worker specs read `dist/app/index.html`, so a stale or missing build would make them run against old code or
 * not run at all. A build runs only when `dist/app/index.html` is missing or older than the newest build input.
 */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** What `npm run build` reads: the app, its assets, the configs, and the build scripts. */
const BUILD_INPUTS = ['src', 'public', 'app', 'index.html', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'package.json', 'scripts'];
const BUILT_ENTRY = 'dist/app/index.html';

/** The newest modification time under a file or directory. */
function newestMtime(path: string): number {
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.mtimeMs;
  return readdirSync(path).reduce((newest, entry) => Math.max(newest, newestMtime(join(path, entry))), stat.mtimeMs);
}

export default function globalSetup(): void {
  const newestInput = Math.max(...BUILD_INPUTS.filter((path) => existsSync(path)).map(newestMtime));
  if (existsSync(BUILT_ENTRY) && statSync(BUILT_ENTRY).mtimeMs >= newestInput) return;
  console.log(`${BUILT_ENTRY} is missing or older than the sources: running npm run build`);
  execSync('npm run build', { stdio: 'inherit' });
}
