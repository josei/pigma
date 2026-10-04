/**
 * Native `.fig` export.
 *
 * Encodes a decoded Kiwi message back into `canvas.fig` (and, with the ZIP
 * helper, a complete `.fig` archive). The schema is reused from a seed file, so
 * export needs no bundled schema copy: pass the same `.fig`/`canvas.fig` you
 * imported from (or any real `.fig`) as `schemaFrom`.
 *
 * Scope: this round-trips a **decoded native document** (and any edits made to
 * its message). Converting the editor model (`PigmaFile`) into `nodeChanges`
 * lives in `modelExport.ts` (`exportPigmaFile`), which feeds this assembler.
 *
 * `kiwi-schema` is an optional peer (encoder only); import is deferred so the
 * importer keeps working without it.
 */
import { FigmaImportError } from '../errors';
import { decodeBinarySchema } from './kiwi';
import { readZipEntries, type Decompressors } from './zip';

/** Compression for the message chunk. Figma requires zstd when writing. */
export interface ExportCompressors {
  /** zstd compression (Node: `zlib.zstdCompressSync`; browser: a zstd encoder). */
  zstd?(bytes: Uint8Array): Uint8Array;
  /** Raw deflate fallback (older files; Figma rejects it on write). */
  deflateRaw?(bytes: Uint8Array): Uint8Array;
}

export interface ExportOptions {
  /** A real `.fig`/`.deck`/`.jam` archive or bare `canvas.fig` providing the schema. */
  schemaFrom: Uint8Array;
  /** Decompressors for reading the seed (same set used to import it). */
  decompress: Decompressors;
  /** Compressors for the message chunk. */
  compress?: ExportCompressors;
  /** Override the prelude/version (defaults: the seed's). */
  prelude?: string;
  version?: number;
  /** Extra chunks (index 2+) to pass through unchanged. */
  extraChunks?: Uint8Array[];
}

/** Read the raw chunk layout of a bare `canvas.fig`. */
export function readCanvasChunks(data: Uint8Array): { prelude: string; version: number; chunks: Uint8Array[] } {
  if (data.byteLength < 12) throw new FigmaImportError('TRUNCATED', 'canvas.fig is too small');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const prelude = new TextDecoder('latin1').decode(data.subarray(0, 8));
  const version = view.getUint32(8, true);
  const chunks: Uint8Array[] = [];
  let offset = 12;
  while (offset < data.byteLength) {
    const length = view.getUint32(offset, true);
    offset += 4;
    if (offset + length > data.byteLength) throw new FigmaImportError('TRUNCATED', 'chunk runs past the end');
    chunks.push(data.subarray(offset, offset + length));
    offset += length;
  }
  return { prelude, version, chunks };
}

let modulePromise: Promise<{ compileSchema(schema: unknown): { encodeMessage(message: unknown): Uint8Array } }> | null = null;

async function loadKiwiSchema(): Promise<{ compileSchema(schema: unknown): { encodeMessage(message: unknown): Uint8Array } }> {
  modulePromise ??= (async () => {
    try {
      const name = 'kiwi-schema';
      return (await import(/* @vite-ignore */ name)) as {
        compileSchema(schema: unknown): { encodeMessage(message: unknown): Uint8Array };
      };
    } catch (cause) {
      modulePromise = null;
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new FigmaImportError(
        'UNSUPPORTED_COMPRESSION',
        `Native .fig export needs the optional \`kiwi-schema\` package (npm install kiwi-schema): ${detail}`,
        { cause },
      );
    }
  })();
  return modulePromise;
}

function assemble(prelude: string, version: number, chunks: Uint8Array[]): Uint8Array {
  const encoder = new TextEncoder();
  const header = new Uint8Array(12);
  const padded = encoder.encode(prelude.padEnd(8, ' ').slice(0, 8));
  header.set(padded, 0);
  new DataView(header.buffer).setUint32(8, version, true);
  const parts: Uint8Array[] = [header];
  for (const chunk of chunks) {
    const prefix = new Uint8Array(4);
    new DataView(prefix.buffer).setUint32(0, chunk.length, true);
    parts.push(prefix, chunk);
  }
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Encode a decoded Kiwi message into `canvas.fig` bytes, reusing the seed's
 * schema chunk (so the schema is never re-derived).
 */
export async function exportFigBinary(
  message: Record<string, unknown>,
  options: ExportOptions,
): Promise<Uint8Array> {
  // Accept either a bare canvas.fig or a full .fig/.deck/.jam archive.
  const seedBytes =
    options.schemaFrom[0] === 0x50 && options.schemaFrom[1] === 0x4b
      ? (readZipEntries(options.schemaFrom, options.decompress).get('canvas.fig') ?? (() => {
          throw new FigmaImportError('UNSUPPORTED_ARCHIVE', 'Seed archive has no canvas.fig');
        })())
      : options.schemaFrom;
  const seed = readCanvasChunks(seedBytes);
  const schemaChunk = seed.chunks[0];
  if (!schemaChunk) throw new FigmaImportError('INVALID_BINARY', 'Seed has no schema chunk');

  const schemaBinary = options.decompress.inflateRaw(schemaChunk);
  const schema = decodeBinarySchema(schemaBinary);
  const kiwi = await loadKiwiSchema();
  const compiled = kiwi.compileSchema(schema);
  const encoded = compiled.encodeMessage(message);

  let messageChunk: Uint8Array;
  if (options.compress?.zstd) {
    messageChunk = options.compress.zstd(encoded);
  } else if (options.compress?.deflateRaw) {
    messageChunk = options.compress.deflateRaw(encoded);
  } else {
    throw new FigmaImportError(
      'UNSUPPORTED_COMPRESSION',
      'Export needs a zstd compressor (Figma rejects deflateRaw on write). Pass `compress.zstd`.',
    );
  }

  return assemble(options.prelude ?? seed.prelude, options.version ?? seed.version, [
    schemaChunk,
    messageChunk,
    ...(options.extraChunks ?? seed.chunks.slice(2)),
  ]);
}

/** Assemble a store-mode ZIP archive from named entries. */
export function zipArchive(entries: Array<[string, Uint8Array]>): Uint8Array {
  const encoder = new TextEncoder();
  const crcTable = ((): Uint32Array => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let value = i;
      for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      table[i] = value >>> 0;
    }
    return table;
  })();
  const crc32 = (bytes: Uint8Array): number => {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = (crc >>> 8) ^ (crcTable[(crc ^ byte) & 0xff] as number);
    return (crc ^ 0xffffffff) >>> 0;
  };

  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBytes = encoder.encode(name);
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    locals.push(local, data);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centrals.push(central);
    offset += local.length + data.length;
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, entries.length, true);
  eocdView.setUint16(10, entries.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, offset, true);

  const parts = [...locals, ...centrals, eocd];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}
