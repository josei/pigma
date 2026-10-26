/**
 * Node.js decompressors for the native `.fig` parser.
 *
 * Kept out of the package barrel (`../index`) so browser bundles never pull in
 * `node:zlib`. Browser callers pass `fflate` (inflate) and `fzstd` (zstd)
 * instead.
 */
import * as zlib from 'node:zlib';
import { decompress as decompressZstd } from 'fzstd';
import type { Decompressors } from './zip';

/**
 * zstd decoding. `zlib.zstdDecompressSync` exists from Node 22.15; older Node
 * (20 is still common) falls back to `fzstd`, the pure-JS decoder the browser path
 * already uses. Decoding only: writing a .fig still needs a zstd encoder.
 */
export const nodeDecompressors: Decompressors = {
  inflateRaw: (bytes) => new Uint8Array(zlib.inflateRawSync(bytes)),
  zstd: (bytes) =>
    typeof zlib.zstdDecompressSync === 'function'
      ? new Uint8Array(zlib.zstdDecompressSync(bytes))
      : decompressZstd(bytes),
};
