/**
 * Node compressors for native `.fig` export.
 *
 * Kept out of the package barrel so browser bundles never pull in `node:zlib`.
 * A browser exporter must supply a zstd encoder (`fzstd` only decompresses).
 */
import * as zlib from 'node:zlib';
import type { ExportCompressors } from './export';

/**
 * `zlib.zstdCompressSync` exists from Node 22.15. On older Node there is no zstd
 * encoder, so `zstd` is left out and the exporter refuses with its own message.
 * No deflate fallback is offered: Figma rejects a deflated message on write, so a
 * fallback would produce a file that looks valid and does not open.
 */
export const nodeExportCompressors: ExportCompressors = {
  zstd: typeof zlib.zstdCompressSync === 'function' ? (bytes) => new Uint8Array(zlib.zstdCompressSync(bytes)) : undefined,
};
