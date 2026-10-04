/**
 * The asset manifest: what a desktop shell downloads, verifies and caches.
 *
 * One bundle serves every build. The web build already detects Tauri at runtime,
 * so the desktop shell does not ship its own copy of the editor — it caches the
 * published assets and loads them, which is what keeps a shell downloaded last
 * year on par with the site today. The shell binary itself still updates through
 * the normal Tauri updater; only the assets move here.
 *
 * Shape (written to `dist/desktop-assets.json` by scripts/desktop-assets.mjs):
 *
 *   {
 *     "schema": "pigma/assets/1",
 *     "version": "<package version>+<content hash>",
 *     "entry": "index.html",
 *     "assets": { "index.html": "<sha256>", "assets/index-abc.js": "<sha256>" }
 *   }
 *
 * Every hash is the sha256 of the file's bytes, so a shell verifies what it
 * downloaded before it activates anything, and a truncated or tampered file is
 * refused rather than served.
 */

export const ASSET_MANIFEST_SCHEMA = 'pigma/assets/1';
/** File name of the manifest inside the built bundle. */
export const ASSET_MANIFEST_FILE = 'desktop-assets.json';

export interface AssetManifest {
  schema: typeof ASSET_MANIFEST_SCHEMA;
  version: string;
  /** Path (relative to the bundle root) the shell loads to start the editor. */
  entry: string;
  /** path -> sha256 hex digest. */
  assets: Record<string, string>;
}

/** Reject anything that is not a manifest this client understands. */
export function parseManifest(value: unknown): AssetManifest | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.schema !== ASSET_MANIFEST_SCHEMA) return null;
  if (typeof record.version !== 'string' || record.version.trim() === '') return null;
  if (typeof record.entry !== 'string' || record.entry.trim() === '') return null;
  const assets = record.assets;
  if (!assets || typeof assets !== 'object' || Array.isArray(assets)) return null;
  const entries: Record<string, string> = {};
  for (const [path, hash] of Object.entries(assets as Record<string, unknown>)) {
    if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/i.test(hash)) return null;
    // A manifest may only name files inside its own bundle: no absolute paths,
    // no `..`, no scheme-looking names.
    if (!isSafeAssetPath(path)) return null;
    entries[path] = hash.toLowerCase();
  }
  if (!(record.entry in entries)) return null;
  return {
    schema: ASSET_MANIFEST_SCHEMA,
    version: record.version.trim(),
    entry: record.entry.trim(),
    assets: entries,
  };
}

/** True for a relative, non-escaping asset path. */
export function isSafeAssetPath(path: string): boolean {
  if (path === '' || path.startsWith('/') || path.includes('\\') || path.includes('\0')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return false;
  return !path.split('/').some((segment) => segment === '..' || segment === '');
}

/** What is installed right now, according to the shell's pointer file. */
export interface AssetPointer {
  version: string;
  entry: string;
  /** The version kept for rollback, if any. */
  previous?: string;
}

export function parsePointer(value: unknown): AssetPointer | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.version !== 'string' || record.version.trim() === '') return null;
  if (typeof record.entry !== 'string' || record.entry.trim() === '') return null;
  const previous = typeof record.previous === 'string' && record.previous.trim() !== '' ? record.previous.trim() : undefined;
  return { version: record.version.trim(), entry: record.entry.trim(), ...(previous ? { previous } : {}) };
}

export type UpdateDecision =
  | { kind: 'current'; version: string; entry: string }
  | { kind: 'install'; version: string; entry: string; files: string[]; reason: 'fresh' | 'changed' }
  | { kind: 'rollback'; version: string; entry: string };

/**
 * Decide what to do with a manifest. `installed` is the pointer's bundle as it
 * exists on disk (path -> hash), or null when nothing is cached.
 *
 * Pure: the shell's IO is the caller's business, so every branch is testable.
 */
export function decideUpdate(
  manifest: AssetManifest | null,
  pointer: AssetPointer | null,
  installed: Record<string, string> | null,
): UpdateDecision {
  if (!pointer || !installed) {
    if (!manifest) {
      // Nothing usable is cached and nothing is reachable: activate the bundle
      // kept for rollback, if there is one.
      return { kind: 'rollback', version: pointer?.previous ?? '', entry: pointer?.entry ?? '' };
    }
    return { kind: 'install', version: manifest.version, entry: manifest.entry, files: Object.keys(manifest.assets).sort(), reason: 'fresh' };
  }
  if (!manifest) {
    // Offline: keep what is cached, whatever it is.
    return { kind: 'current', version: pointer.version, entry: pointer.entry };
  }
  if (manifest.version === pointer.version) {
    return { kind: 'current', version: pointer.version, entry: pointer.entry };
  }
  const files = changedFiles(manifest, installed);
  return files.length === 0
    ? { kind: 'current', version: pointer.version, entry: pointer.entry }
    : { kind: 'install', version: manifest.version, entry: manifest.entry, files, reason: 'changed' };
}

/**
 * Files that differ between the manifest and what is cached: new names, changed
 * hashes, and names the manifest dropped (which are simply not downloaded).
 */
export function changedFiles(manifest: AssetManifest, installed: Record<string, string>): string[] {
  return Object.keys(manifest.assets)
    .filter((path) => installed[path] !== manifest.assets[path])
    .sort();
}

/** Paths present in the cached bundle but missing from the manifest. */
export function staleFiles(manifest: AssetManifest, installed: Record<string, string>): string[] {
  return Object.keys(installed)
    .filter((path) => !(path in manifest.assets))
    .sort();
}

export interface VerificationResult {
  ok: boolean;
  /** Files whose bytes do not match the manifest hash. */
  mismatched: string[];
  /** Files the manifest names but the bundle does not contain. */
  missing: string[];
}

/** Check a downloaded bundle against the manifest before it is activated. */
export function verifyBundle(
  manifest: AssetManifest,
  hashes: Record<string, string>,
): VerificationResult {
  const mismatched: string[] = [];
  const missing: string[] = [];
  for (const [path, expected] of Object.entries(manifest.assets)) {
    const actual = hashes[path];
    if (actual === undefined) missing.push(path);
    else if (actual.toLowerCase() !== expected) mismatched.push(path);
  }
  return {
    ok: mismatched.length === 0 && missing.length === 0,
    mismatched: mismatched.sort(),
    missing: missing.sort(),
  };
}

/** The relative directory a version is cached under. */
export function assetDir(version: string): string {
  // The version is used as a path segment: keep it to a safe alphabet.
  const safe = version.replace(/[^A-Za-z0-9._+-]/g, '_');
  return `assets/${safe}`;
}

/**
 * The filesystem the shell provides. Every call is a no-op-free contract: the
 * shell implements it with Tauri commands rooted at `appDataDir`, so the update
 * logic never touches the user's documents.
 */
export interface AssetIO {
  /** Read a UTF-8 file, or null when it does not exist. */
  readText: (path: string) => Promise<string | null>;
  writeText: (path: string, contents: string) => Promise<void>;
  /** Write bytes (the shell streams the download straight to disk). */
  writeBytes: (path: string, bytes: Uint8Array) => Promise<void>;
  /** Delete a file or directory tree; missing paths are not an error. */
  remove: (path: string) => Promise<void>;
  /** Rename, replacing the destination. Used for the atomic pointer swap. */
  rename: (from: string, to: string) => Promise<void>;
  /** Copy a file inside the cache (an unchanged asset is never re-downloaded). */
  copy: (from: string, to: string) => Promise<void>;
  /** List a directory tree as path -> sha256. Missing directory -> {}. */
  hashTree: (dir: string) => Promise<Record<string, string>>;
}

export interface AssetUpdateResult {
  status: 'current' | 'updated' | 'rollback' | 'failed';
  version: string;
  entry: string;
  /** Files downloaded in this run. */
  downloaded: string[];
  reason?: string;
}

export const ASSET_POINTER_FILE = 'current.json';

/**
 * Fetch a manifest (null when unreachable — the offline case), then bring the
 * cache up to date. The bundle is downloaded into `assets/<version>.tmp`,
 * verified against the manifest, renamed into place, and only then does the
 * pointer move. The previous version is left on disk for rollback.
 */
export async function updateAssets(options: {
  io: AssetIO;
  fetchManifest: () => Promise<unknown>;
  fetchAsset: (path: string) => Promise<Uint8Array>;
  hash: (bytes: Uint8Array) => Promise<string>;
  /** Where the shell keeps its cache, e.g. `assets` under appDataDir. */
  root?: string;
}): Promise<AssetUpdateResult> {
  const { io, fetchManifest, fetchAsset, hash } = options;
  const root = options.root ?? '';

  const rawPointer = await io.readText(join(root, ASSET_POINTER_FILE));
  const pointer = rawPointer ? parsePointer(safeJson(rawPointer)) : null;
  const installed = pointer ? await io.hashTree(join(root, assetDir(pointer.version))) : null;
  const cached = installed && Object.keys(installed).length > 0 ? installed : null;

  const manifest = parseManifest(await safeCall(fetchManifest));
  const decision = decideUpdate(manifest, pointer, cached);

  if (decision.kind === 'current') {
    return { status: 'current', version: decision.version, entry: decision.entry, downloaded: [] };
  }
  if (decision.kind === 'rollback') {
    if (!pointer?.previous) {
      return { status: 'failed', version: '', entry: '', downloaded: [], reason: 'no cached bundle to fall back to' };
    }
    await writePointer(io, root, { version: pointer.previous, entry: pointer.entry });
    return { status: 'rollback', version: pointer.previous, entry: pointer.entry, downloaded: [] };
  }

  const target = join(root, assetDir(decision.version));
  const staging = `${target}.tmp`;
  await io.remove(staging);
  const downloaded: string[] = [];
  const hashes: Record<string, string> = {};
  try {
    for (const path of decision.files) {
      const bytes = await fetchAsset(path);
      await io.writeBytes(join(staging, path), bytes);
      hashes[path] = await hash(bytes);
      downloaded.push(path);
    }
    // Assets this version already had are copied from the previous bundle, never
    // re-downloaded: a release usually changes one or two files.
    for (const path of Object.keys(manifest!.assets)) {
      if (path in hashes) continue;
      const previous = cached?.[path];
      if (previous === undefined || pointer === null) continue;
      await io.copy(`${join(root, assetDir(pointer.version))}/${path}`, join(staging, path));
      hashes[path] = previous;
    }
    const verification = verifyBundle(manifest!, hashes);
    if (!verification.ok) {
      await io.remove(staging);
      return {
        status: 'failed',
        version: pointer?.version ?? '',
        entry: pointer?.entry ?? '',
        downloaded,
        reason: `bundle failed verification (${verification.mismatched.length} mismatched, ${verification.missing.length} missing)`,
      };
    }
    await io.remove(target);
    await io.rename(staging, target);
  } catch (error) {
    await io.remove(staging);
    return {
      status: 'failed',
      version: pointer?.version ?? '',
      entry: pointer?.entry ?? '',
      downloaded,
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  await writePointer(io, root, {
    version: decision.version,
    entry: decision.entry,
    // The version being replaced stays on disk for one rollback.
    ...(pointer ? { previous: pointer.version } : {}),
  });
  return { status: 'updated', version: decision.version, entry: decision.entry, downloaded };
}

/** Move the pointer back to the previous bundle, when one is kept. */
export async function rollbackAssets(options: { io: AssetIO; root?: string }): Promise<AssetUpdateResult> {
  const root = options.root ?? '';
  const pointer = parsePointer(safeJson((await options.io.readText(join(root, ASSET_POINTER_FILE))) ?? ''));
  if (!pointer?.previous) {
    return { status: 'failed', version: pointer?.version ?? '', entry: pointer?.entry ?? '', downloaded: [], reason: 'nothing to roll back to' };
  }
  await writePointer(options.io, root, {
    version: pointer.previous,
    entry: pointer.entry,
    previous: pointer.version,
  });
  return { status: 'rollback', version: pointer.previous, entry: pointer.entry, downloaded: [] };
}

/**
 * The bundle the shell should load right now: the pointer's version, falling
 * back to the previous one when the current bundle is incomplete. Works offline:
 * no network is involved.
 */
export async function resolveActiveBundle(options: {
  io: AssetIO;
  root?: string;
}): Promise<{ version: string; entry: string; dir: string } | null> {
  const root = options.root ?? '';
  const pointer = parsePointer(safeJson((await options.io.readText(join(root, ASSET_POINTER_FILE))) ?? ''));
  if (!pointer) return null;
  for (const version of [pointer.version, pointer.previous].filter((value): value is string => Boolean(value))) {
    const dir = join(root, assetDir(version));
    const hashes = await options.io.hashTree(dir);
    if (hashes[pointer.entry]) return { version, entry: pointer.entry, dir };
  }
  return null;
}

async function writePointer(io: AssetIO, root: string, pointer: AssetPointer): Promise<void> {
  const path = join(root, ASSET_POINTER_FILE);
  const temporary = `${path}.tmp`;
  // Write-then-rename: the pointer is never half-written, so a crash mid-update
  // leaves the previous bundle active.
  await io.writeText(temporary, `${JSON.stringify(pointer, null, 2)}\n`);
  await io.rename(temporary, path);
}

function join(root: string, path: string): string {
  if (root === '') return path;
  return `${root.replace(/\/+$/, '')}/${path}`;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function safeCall<T>(call: () => Promise<T>): Promise<T | null> {
  try {
    return await call();
  } catch {
    return null;
  }
}
