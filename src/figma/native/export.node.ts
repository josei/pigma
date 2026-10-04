/**
 * Node compressors for native `.fig` export.
 *
 * Kept out of the package barrel so browser bundles never pull in `node:zlib`.
 * A browser exporter must supply a zstd encoder (`fzstd` only decompresses).
 */
import { deflateRawSync, zstdCompressSync } from 'node:zlib';
import type { ExportCompressors } from './export';

export const nodeExportCompressors: ExportCompressors = {
  zstd: (bytes) => new Uint8Array(zstdCompressSync(bytes)),
  deflateRaw: (bytes) => new Uint8Array(deflateRawSync(bytes)),
};
