import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { ASSET_MANIFEST_FILE, parseManifest } from './assets';
import { buildManifest } from '../../scripts/desktop-assets.mjs';
import { CONFIG_PATH } from '../../server/config';

/**
 * The manifest the build writes is a contract with the desktop shell
 * (src-tauri/src/assets.rs). The shell parses it with the same rules the client
 * here applies, so this checks a *generated* manifest against them.
 *
 * It generates its own bundle in a temp directory rather than reading `dist/`:
 * the test must not depend on whether anyone ran a build first, or the unit count
 * changes with the state of the working tree (780 + 1 skipped without a build,
 * 781 with one).
 */
const tempRoot = mkdtempSync(join(tmpdir(), 'pigma-manifest-'));
const tempDist = join(tempRoot, 'dist');
mkdirSync(join(tempDist, 'assets'), { recursive: true });
writeFileSync(join(tempDist, 'index.html'), '<!doctype html><div id="root"></div>');
writeFileSync(join(tempDist, 'assets', 'index-abc.js'), 'console.log("pigma");');
writeFileSync(join(tempDist, 'assets', 'index-abc.css'), 'body{margin:0}');
// A stale manifest in the bundle is never described by the new one.
writeFileSync(join(tempDist, ASSET_MANIFEST_FILE), '{}');
writeFileSync(join(tempRoot, 'package.json'), JSON.stringify({ name: 'pigma', version: '9.9.9' }));

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe('generated asset manifest', () => {
  it('is one the shell accepts, with every asset hashed', async () => {
    const generated = await buildManifest({ distDir: tempDist, packageFile: join(tempRoot, 'package.json') });
    const manifest = parseManifest(generated);
    expect(manifest, 'the shell would refuse this manifest').not.toBeNull();

    // The entry is inside the bundle, every path is relative, every digest is a
    // sha256, and the version carries the package version plus a content digest.
    expect(manifest!.entry).toBe('index.html');
    expect(Object.keys(manifest!.assets)).toContain(manifest!.entry);
    expect(Object.keys(manifest!.assets).sort()).toEqual(['assets/index-abc.css', 'assets/index-abc.js', 'index.html']);
    for (const [path, hash] of Object.entries(manifest!.assets)) {
      expect(path.startsWith('/')).toBe(false);
      expect(path.includes('..')).toBe(false);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(manifest!.version).toMatch(/^9\.9\.9\+[0-9a-f]{12}$/);
    // The manifest never describes itself.
    expect(manifest!.assets[ASSET_MANIFEST_FILE]).toBeUndefined();

    // The same bytes hash the same, and a change to one file changes its digest
    // (and the version) without touching the others.
    const again = await buildManifest({ distDir: tempDist, packageFile: join(tempRoot, 'package.json') });
    expect(again).toEqual(generated);
    writeFileSync(join(tempDist, 'assets', 'index-abc.js'), 'console.log("changed");');
    const changed = await buildManifest({ distDir: tempDist, packageFile: join(tempRoot, 'package.json') });
    expect(changed.assets['index.html']).toBe(generated.assets['index.html']);
    expect(changed.assets['assets/index-abc.js']).not.toBe(generated.assets['assets/index-abc.js']);
    expect(changed.version).not.toBe(generated.version);
  });

  it('refuses a bundle with no entry', async () => {
    const empty = join(tempRoot, 'empty');
    mkdirSync(empty, { recursive: true });
    await expect(buildManifest({ distDir: empty, packageFile: join(tempRoot, 'package.json') })).rejects.toThrow(
      /index\.html/,
    );
  });

  it('agrees with the bundle in dist/ when one has been built', () => {
    // Not a skip: the assertions above always run. This only checks that the
    // checked-in build output, when present, is the same shape — an extra
    // assertion, never a conditional test count.
    const built = fileURLToPath(new URL('../../dist/desktop-assets.json', import.meta.url));
    if (!existsSync(built)) return;
    const manifest = parseManifest(JSON.parse(readFileSync(built, 'utf8')));
    expect(manifest, 'the built manifest is not one the shell accepts').not.toBeNull();
    expect(manifest!.entry).toBe('index.html');
  });

  it('is not confused with the deployment config surface', () => {
    // Two different files with two different jobs: `/config.json` says where MCP
    // is (src/config/mcpAvailability.ts), the manifest says which bytes are the
    // app (src/desktop/assets.ts).
    expect(CONFIG_PATH).toBe('/config.json');
    expect(ASSET_MANIFEST_FILE).toBe('desktop-assets.json');
  });
});

describe('the manifest script as a module', () => {
  it('imports without running the CLI and without ever rejecting', async () => {
    // A test importing it must not run the CLI. `process.argv[1]` is set to a
    // path that does not exist, which is exactly the case the entry-point check
    // used to turn into an unhandled rejection from a top-level `await realpath`.
    const script = fileURLToPath(new URL('../../scripts/desktop-assets.mjs', import.meta.url));
    const probe = [
      `process.argv[1] = '/definitely/not/a/real/script.mjs';`,
      `const mod = await import(${JSON.stringify(`file://${script}`)});`,
      `console.log(typeof mod.buildManifest === 'function' ? 'ok' : 'missing-export');`,
    ].join(' ');
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', probe], { encoding: 'utf8' });
    expect(output.trim()).toBe('ok');
  });
});
