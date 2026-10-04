/**
 * Node.js decompressors for the native `.fig` parser.
 *
 * Kept out of the package barrel (`../index`) so browser bundles never pull in
 * `node:zlib`. Browser callers pass `fflate` (inflate) and `fzstd` (zstd)
 * instead — see `docs/FIGMA_IMPORT.md`.
 */
import { inflateRawSync, zstdDecompressSync } from 'node:zlib';
import type { Decompressors } from './zip';

export const nodeDecompressors: Decompressors = {
  inflateRaw: (bytes) => new Uint8Array(inflateRawSync(bytes)),
  zstd: (bytes) => new Uint8Array(zstdDecompressSync(bytes)),
};
