#!/usr/bin/env node
/**
 * Write `dist/desktop-assets.json`: the manifest a desktop shell fetches to keep
 * its cached assets on par with the web build.
 *
 * Runs as the last step of `npm run build`, so the manifest always describes the
 * bytes that were just written. The version is the package version plus a digest
 * of the asset set: an asset-only change still produces a new version, and the
 * shell never has to guess whether it is behind.
 *
 * Shape and semantics: src/desktop/assets.ts (the client that consumes it).
 */
import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const distDir = join(root, 'dist');

/** Files the manifest never lists: they are build metadata, not bundle assets. */
const EXCLUDED = new Set(['desktop-assets.json']);

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

/**
 * Build the manifest for a built bundle directory.
 *
 * Exported so the contract test can generate one into a temp directory and
 * assert the shape without depending on whether anyone happened to run a build:
 * the unit count must not change with the state of `dist/`.
 */
export async function buildManifest({ distDir: target, packageFile = join(root, 'package.json') }) {
  const info = await stat(target).catch(() => null);
  if (!info?.isDirectory()) {
    throw new Error(`no bundle directory at ${target} — run vite build first`);
  }

  const files = (await walk(target)).sort();
  const assets = {};
  const digests = [];
  for (const file of files) {
    const path = relative(target, file).split(sep).join('/');
    if (EXCLUDED.has(path)) continue;
    const bytes = await readFile(file);
    const hash = createHash('sha256').update(bytes).digest('hex');
    assets[path] = hash;
    digests.push(`${path}:${hash}`);
  }

  if (!('index.html' in assets)) {
    throw new Error(`${target}/index.html is missing — the bundle has no entry`);
  }

  const pkg = JSON.parse(await readFile(packageFile, 'utf8'));
  const contentDigest = createHash('sha256').update(digests.join('\n')).digest('hex').slice(0, 12);
  return {
    schema: 'pigma/assets/1',
    version: `${pkg.version}+${contentDigest}`,
    entry: 'index.html',
    assets,
  };
}

/** Write the manifest into a bundle directory (what `npm run build` does). */
export async function writeManifest({ distDir: target, packageFile } = {}) {
  const manifest = await buildManifest({ distDir: target ?? distDir, ...(packageFile ? { packageFile } : {}) });
  const path = join(target ?? distDir, 'desktop-assets.json');
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { manifest, path };
}

/**
 * True when this module is the entry point, rather than an import from a test.
 *
 * `realpath` is used so a symlinked repository still matches, but it throws when
 * `argv[1]` does not exist (a deleted or renamed script, an odd launcher). That
 * must never surface as an unhandled rejection from a top-level await, so a
 * failed realpath simply means "not the entry" and the plain resolved paths are
 * compared instead.
 */
async function isEntryPoint() {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(import.meta.url);
  try {
    return (await realpath(entry)) === self;
  } catch {
    return resolve(entry) === self;
  }
}

/** Run as a script (`npm run build`'s last step), not when imported by a test. */
if (await isEntryPoint()) {
  try {
    const { manifest, path } = await writeManifest();
    console.log(`desktop-assets: ${Object.keys(manifest.assets).length} file(s), version ${manifest.version} -> ${relative(root, path)}`);
  } catch (error) {
    console.error(`desktop-assets: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
