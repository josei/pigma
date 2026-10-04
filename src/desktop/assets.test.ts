import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  ASSET_MANIFEST_SCHEMA,
  ASSET_POINTER_FILE,
  assetDir,
  changedFiles,
  decideUpdate,
  parseManifest,
  parsePointer,
  resolveActiveBundle,
  rollbackAssets,
  staleFiles,
  updateAssets,
  verifyBundle,
  type AssetIO,
  type AssetManifest,
} from './assets';

const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

/** An in-memory filesystem with the same contract the shell implements. */
function memoryIO(): AssetIO & { files: Map<string, string>; bytes: Map<string, Uint8Array> } {
  const files = new Map<string, string>();
  const bytes = new Map<string, Uint8Array>();
  return {
    files,
    bytes,
    readText: async (path) => files.get(path) ?? null,
    writeText: async (path, contents) => void files.set(path, contents),
    writeBytes: async (path, data) => void bytes.set(path, data),
    remove: async (path) => {
      for (const key of [...files.keys()]) if (key === path || key.startsWith(`${path}/`)) files.delete(key);
      for (const key of [...bytes.keys()]) if (key === path || key.startsWith(`${path}/`)) bytes.delete(key);
    },
    rename: async (from, to) => {
      // Directory-aware: the shell renames the staged bundle into place.
      for (const [key, value] of [...files]) {
        if (key !== from && !key.startsWith(`${from}/`)) continue;
        files.delete(key);
        files.set(`${to}${key.slice(from.length)}`, value);
      }
      for (const [key, value] of [...bytes]) {
        if (key !== from && !key.startsWith(`${from}/`)) continue;
        bytes.delete(key);
        bytes.set(`${to}${key.slice(from.length)}`, value);
      }
    },
    copy: async (from, to) => {
      const data = bytes.get(from);
      if (data !== undefined) bytes.set(to, data);
      const text = files.get(from);
      if (text !== undefined) files.set(to, text);
    },
    hashTree: async (dir) => {
      const out: Record<string, string> = {};
      for (const [path, data] of bytes) {
        if (!path.startsWith(`${dir}/`)) continue;
        out[path.slice(dir.length + 1)] = sha(Buffer.from(data).toString('utf8'));
      }
      return out;
    },
  };
}

const manifest = (version: string, assets: Record<string, string>): AssetManifest => ({
  schema: ASSET_MANIFEST_SCHEMA,
  version,
  entry: 'index.html',
  assets,
});

/** A served bundle: manifest + the bytes for each path. */
function serving(bundle: Record<string, string>): { manifest: AssetManifest; fetch: (path: string) => Promise<Uint8Array> } {
  const assets = Object.fromEntries(Object.entries(bundle).map(([path, text]) => [path, sha(text)]));
  return {
    manifest: manifest('1.0.0+aaaa', assets),
    fetch: async (path) => new TextEncoder().encode(bundle[path] ?? ''),
  };
}

describe('manifest parsing', () => {
  it('accepts a well-formed manifest and rejects everything else', () => {
    const good = manifest('1.0.0+abc', { 'index.html': sha('a'), 'assets/app.js': sha('b') });
    expect(parseManifest(good)).toEqual(good);
    expect(parseManifest(null)).toBeNull();
    expect(parseManifest({ ...good, schema: 'pigma/assets/2' })).toBeNull();
    expect(parseManifest({ ...good, version: '' })).toBeNull();
    expect(parseManifest({ ...good, entry: 'missing.html' })).toBeNull();
    // A short or non-hex digest is not a digest.
    expect(parseManifest({ ...good, assets: { 'index.html': 'abc' } })).toBeNull();
    // Paths may not escape the bundle.
    expect(parseManifest({ ...good, assets: { '../secret': sha('a') }, entry: '../secret' })).toBeNull();
    expect(parseManifest({ ...good, assets: { '/etc/passwd': sha('a') }, entry: '/etc/passwd' })).toBeNull();
    expect(parseManifest({ ...good, assets: { 'https://evil.test/x': sha('a') }, entry: 'https://evil.test/x' })).toBeNull();
  });

  it('reads a pointer, with or without a previous bundle', () => {
    expect(parsePointer({ version: '1.0.0+a', entry: 'index.html' })).toEqual({ version: '1.0.0+a', entry: 'index.html' });
    expect(parsePointer({ version: '1.0.0+a', entry: 'index.html', previous: '0.9.0+b' })).toMatchObject({ previous: '0.9.0+b' });
    expect(parsePointer({ entry: 'index.html' })).toBeNull();
    expect(parsePointer('nonsense')).toBeNull();
  });

  it('keeps version segments path-safe', () => {
    expect(assetDir('1.0.0+abc')).toBe('assets/1.0.0+abc');
    expect(assetDir('../../etc')).toBe('assets/.._.._etc');
  });
});

describe('update decisions', () => {
  const current = manifest('1.0.0+aaaa', { 'index.html': sha('a') });

  it('is a fresh install when nothing is cached', () => {
    expect(decideUpdate(current, null, null)).toMatchObject({ kind: 'install', reason: 'fresh', files: ['index.html'] });
  });

  it('stays current when the version matches, or when nothing changed', () => {
    const installed = { 'index.html': sha('a') };
    expect(decideUpdate(current, { version: '1.0.0+aaaa', entry: 'index.html' }, installed)).toMatchObject({ kind: 'current' });
    // Same content under a new version: no files to fetch, so nothing changes.
    const renamed = manifest('1.0.0+bbbb', { 'index.html': sha('a') });
    expect(decideUpdate(renamed, { version: '1.0.0+aaaa', entry: 'index.html' }, installed)).toMatchObject({ kind: 'current' });
  });

  it('installs only the files that changed', () => {
    const next = manifest('1.0.0+bbbb', { 'index.html': sha('a'), 'assets/app.js': sha('b') });
    const decision = decideUpdate(next, { version: '1.0.0+aaaa', entry: 'index.html' }, { 'index.html': sha('a') });
    expect(decision).toMatchObject({ kind: 'install', reason: 'changed', files: ['assets/app.js'] });
    expect(changedFiles(next, { 'index.html': sha('a'), 'old.js': sha('c') })).toEqual(['assets/app.js']);
    expect(staleFiles(next, { 'index.html': sha('a'), 'old.js': sha('c') })).toEqual(['old.js']);
  });

  it('keeps the cached bundle when the manifest is unreachable', () => {
    expect(decideUpdate(null, { version: '1.0.0+aaaa', entry: 'index.html' }, { 'index.html': sha('a') })).toMatchObject({
      kind: 'current',
      version: '1.0.0+aaaa',
    });
    // Nothing cached and nothing reachable: fall back to the previous bundle.
    expect(decideUpdate(null, { version: '1.0.0+b', entry: 'index.html', previous: '1.0.0+a' }, null)).toMatchObject({
      kind: 'rollback',
      version: '1.0.0+a',
    });
  });

  it('verifies every asset against the manifest', () => {
    const target = manifest('1.0.0+a', { 'index.html': sha('a'), 'app.js': sha('b') });
    expect(verifyBundle(target, { 'index.html': sha('a'), 'app.js': sha('b') })).toMatchObject({ ok: true });
    expect(verifyBundle(target, { 'index.html': sha('a'), 'app.js': sha('tampered') })).toMatchObject({
      ok: false,
      mismatched: ['app.js'],
    });
    expect(verifyBundle(target, { 'index.html': sha('a') })).toMatchObject({ ok: false, missing: ['app.js'] });
  });
});

describe('updating the cached bundle', () => {
  const hash = async (bytes: Uint8Array): Promise<string> => sha(Buffer.from(bytes).toString('utf8'));

  it('installs a fresh bundle, then reports itself current', async () => {
    const io = memoryIO();
    const { manifest: served, fetch } = serving({ 'index.html': 'v1', 'assets/app.js': 'one' });
    const first = await updateAssets({ io, fetchManifest: async () => served, fetchAsset: fetch, hash });
    expect(first).toMatchObject({ status: 'updated', version: '1.0.0+aaaa', downloaded: ['assets/app.js', 'index.html'] });

    const pointer = JSON.parse(io.files.get(ASSET_POINTER_FILE)!);
    expect(pointer).toMatchObject({ version: '1.0.0+aaaa', entry: 'index.html' });
    expect(pointer.previous).toBeUndefined();
    // The bundle really is on disk, under its versioned directory.
    expect(io.bytes.has(`${assetDir('1.0.0+aaaa')}/index.html`)).toBe(true);

    const again = await updateAssets({ io, fetchManifest: async () => served, fetchAsset: fetch, hash });
    expect(again).toMatchObject({ status: 'current', downloaded: [] });
  });

  it('keeps the previous bundle and swaps the pointer atomically', async () => {
    const io = memoryIO();
    const v1 = serving({ 'index.html': 'v1', 'assets/app.js': 'one' });
    await updateAssets({ io, fetchManifest: async () => v1.manifest, fetchAsset: v1.fetch, hash });

    const v2 = {
      manifest: manifest('1.0.0+bbbb', { 'index.html': sha('v2'), 'assets/app.js': sha('one') }),
      fetch: async (path: string) => new TextEncoder().encode(path === 'index.html' ? 'v2' : 'one'),
    };
    const second = await updateAssets({ io, fetchManifest: async () => v2.manifest, fetchAsset: v2.fetch, hash });
    // Only the changed file was fetched, and the old bundle is still there.
    expect(second).toMatchObject({ status: 'updated', downloaded: ['index.html'] });
    expect(JSON.parse(io.files.get(ASSET_POINTER_FILE)!)).toMatchObject({ version: '1.0.0+bbbb', previous: '1.0.0+aaaa' });
    expect(io.bytes.has(`${assetDir('1.0.0+aaaa')}/index.html`)).toBe(true);
    expect(io.bytes.has(`${assetDir('1.0.0+bbbb')}/index.html`)).toBe(true);
    // The pointer is written through a temporary file, so it is never partial.
    expect([...io.files.keys()].some((key) => key.endsWith('.tmp'))).toBe(false);
  });

  it('refuses a bundle that fails verification and keeps the old one active', async () => {
    const io = memoryIO();
    const v1 = serving({ 'index.html': 'v1' });
    await updateAssets({ io, fetchManifest: async () => v1.manifest, fetchAsset: v1.fetch, hash });

    const tampered = {
      manifest: manifest('1.0.0+cccc', { 'index.html': sha('v2') }),
      fetch: async () => new TextEncoder().encode('tampered'),
    };
    const result = await updateAssets({ io, fetchManifest: async () => tampered.manifest, fetchAsset: tampered.fetch, hash });
    expect(result.status).toBe('failed');
    expect(result.reason).toMatch(/verification/);
    expect(JSON.parse(io.files.get(ASSET_POINTER_FILE)!)).toMatchObject({ version: '1.0.0+aaaa' });
    expect(io.bytes.has(`${assetDir('1.0.0+cccc')}/index.html`)).toBe(false);
    expect([...io.bytes.keys()].some((key) => key.includes('.tmp'))).toBe(false);
  });

  it('keeps working offline and rolls back on demand', async () => {
    const io = memoryIO();
    const v1 = serving({ 'index.html': 'v1' });
    await updateAssets({ io, fetchManifest: async () => v1.manifest, fetchAsset: v1.fetch, hash });
    const v2 = { manifest: manifest('1.0.0+bbbb', { 'index.html': sha('v2') }), fetch: async () => new TextEncoder().encode('v2') };
    await updateAssets({ io, fetchManifest: async () => v2.manifest, fetchAsset: v2.fetch, hash });

    // Offline: the manifest fetch fails, the cached bundle stays.
    const offline = await updateAssets({
      io,
      fetchManifest: async () => {
        throw new Error('offline');
      },
      fetchAsset: async () => {
        throw new Error('offline');
      },
      hash,
    });
    expect(offline).toMatchObject({ status: 'current', version: '1.0.0+bbbb' });

    // What the shell loads, with no network involved.
    const active = await resolveActiveBundle({ io });
    expect(active).toMatchObject({ version: '1.0.0+bbbb', entry: 'index.html' });
    expect(active!.dir).toBe(assetDir('1.0.0+bbbb'));

    const back = await rollbackAssets({ io });
    expect(back).toMatchObject({ status: 'rollback', version: '1.0.0+aaaa' });
    expect(await resolveActiveBundle({ io })).toMatchObject({ version: '1.0.0+aaaa' });
  });

  it('falls back to the previous bundle when the active one is incomplete', async () => {
    const io = memoryIO();
    io.files.set(ASSET_POINTER_FILE, JSON.stringify({ version: '1.0.0+bbbb', entry: 'index.html', previous: '1.0.0+aaaa' }));
    io.bytes.set(`${assetDir('1.0.0+aaaa')}/index.html`, new TextEncoder().encode('v1'));
    expect(await resolveActiveBundle({ io })).toMatchObject({ version: '1.0.0+aaaa' });

    // Nothing at all: the shell has no bundle to load.
    const empty = memoryIO();
    expect(await resolveActiveBundle({ io: empty })).toBeNull();
  });
});
