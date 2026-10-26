/**
 * Types for the manifest generator (scripts/desktop-assets.mjs).
 *
 * The script stays plain JavaScript because `npm run build` runs it with `node`
 * directly, after Vite has finished; this declaration is what lets the contract
 * test import it and stay type-checked.
 */
export interface GeneratedManifest {
  schema: 'pigma/assets/1';
  version: string;
  entry: string;
  assets: Record<string, string>;
}

export interface ManifestOptions {
  /** Built bundle directory to describe. Defaults to `dist/`. */
  distDir?: string;
  /** package.json to take the version from. Defaults to the repository's. */
  packageFile?: string;
}

export function buildManifest(options: ManifestOptions): Promise<GeneratedManifest>;
export function writeManifest(options?: ManifestOptions): Promise<{ manifest: GeneratedManifest; path: string }>;
